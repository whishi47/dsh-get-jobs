/**
 * Backend supervisor: probe, start (jar first, Gradle as fallback), stop, watch
 * for unexpected exits and bring the process back, and keep a redacted log tail
 * for diagnostics.
 * @module dsh-get-jobs/backend/supervisor
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { ResolvedConfig } from '../config.js'
import { findProjectRoot, PACKAGE_ROOT } from '../layout.js'
import { detectJdk21, findJar, gradleCommand, type JdkInfo } from './jdk.js'
import { detectNode } from './node-runtime.js'
import { downloadFile, jarCachePath, jarCacheUsable, planBackendLaunch, DEFAULT_JAR_URL, DEFAULT_DB_URL, DB_MAX_BYTES, JAR_MAX_BYTES } from './provision.js'

/** Observable backend state. */
export type BackendState = 'unknown' | 'probing' | 'ready' | 'starting' | 'failed'

/** Snapshot returned to callers. */
export interface BackendStatus {
  state: BackendState
  reachable: boolean
  managed: boolean
  pid?: number
  jar?: string
  logPath?: string
  message: string
}

/** Startup outcome. */
export interface StartResult extends BackendStatus {
  started: boolean
  waitedMs: number
}

const MAX_LOG_LINES = 200

/** How many times an unexpected exit triggers a restart before giving up. */
const MAX_RESTARTS = 3

/** Delay before each restart attempt, indexed by attempt number. */
const RESTART_DELAYS = [3_000, 10_000, 30_000] as const

/** Delay for attempt `index`, clamped to the last entry. */
function restartDelay(index: number): number {
  return RESTART_DELAYS[Math.min(index, RESTART_DELAYS.length - 1)] ?? 30_000
}

/** Redact credentials before anything is shown or written to disk. */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-****')
    .replace(/(key=)[A-Za-z0-9-]{8,}/gi, '$1****')
    .replace(/("?(?:API_KEY|HOOK_URL)"?\s*[:=]\s*")[^"]+(")/gi, '$1****$2')
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

export class BackendSupervisor {
  private child: ChildProcess | undefined
  private childPid: number | undefined
  private jarPath: string | undefined
  private logPath: string | undefined
  private tail: string[] = []
  private state: BackendState = 'unknown'
  private message = '尚未探测'

  /** True once a spawn attempt has been made and not yet resolved. */
  private starting = false
  /** Set while `stop()` runs, so the exit handler does not treat it as a crash. */
  private stopping = false
  /** Set when the process was killed on purpose or restarts are exhausted. */
  private giveUp = false
  private restarts = 0
  private restartTimer: ReturnType<typeof setTimeout> | undefined
  /** Dedupe concurrent `ensureRunning` calls (autostart racing with a tool call). */
  private inflight: Promise<StartResult> | undefined

  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Project directory: explicit config, then discovery from the plugin's own
   * location (handles both "plugin inside project" and "plugin beside project"),
   * then the host's working directory.
   */
  get projectDir(): string {
    if (this.config.projectDir) return resolve(this.config.projectDir)
    return findProjectRoot(PACKAGE_ROOT) ?? findProjectRoot(process.cwd()) ?? resolve(PACKAGE_ROOT, '..')
  }

  /** Whether `/api/health` answers right now. */
  async probe(timeoutMs = 2500): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /** Current status without touching the network. */
  status(): BackendStatus {
    return {
      state: this.state,
      reachable: this.state === 'ready',
      managed: Boolean(this.childPid),
      pid: this.childPid,
      jar: this.jarPath,
      logPath: this.logPath,
      message: this.message,
    }
  }

  /** Last `lines` log lines, already redacted. */
  logTail(lines = 40): string {
    return this.tail.slice(-lines).join('\n')
  }

  /**
   * Ensure the backend is running. Cheap path: already reachable → return.
   * Otherwise spawn (jar preferred) and poll until healthy or `waitMs` elapses.
   *
   * Concurrent callers share one attempt: autostart on mount and a user hitting
   * "启动" at the same instant must not spawn two JVMs on the same port.
   */
  async ensureRunning(waitMs = 90_000): Promise<StartResult> {
    if (this.inflight) return this.inflight
    this.inflight = this.run(waitMs).finally(() => { this.inflight = undefined })
    return this.inflight
  }

  private async run(waitMs: number): Promise<StartResult> {
    this.state = 'probing'
    if (await this.probe()) {
      this.state = 'ready'
      this.message = '后端已在运行'
      return { ...this.status(), started: false, waitedMs: 0 }
    }

    if (this.child && this.childPid) {
      // 已有子进程在爬健康检查：deadline 从现在起算即可
      const deadline = Date.now() + waitMs
      const ok = await this.waitHealthy(deadline)
      return { ...this.status(), started: false, waitedMs: waitMs - Math.max(0, deadline - Date.now()), message: ok ? '后端就绪' : this.message }
    }

    const jdk = detectJdk21(this.config.javaHome)
    if (!jdk) {
      this.state = 'failed'
      this.giveUp = true
      this.message = '未找到 JDK 21：安装后设置插件配置 javaHome，或加入 JAVA_HOME'
      return { ...this.status(), started: false, waitedMs: 0 }
    }

    // 三级来源：显式 jarPath → 项目 build/libs → jarUrl 下载（公开安装模式）。
    // 下载模式下没有源码仓库，工作目录用 dataDir，db 模板一并自动就位
    const projectDir = this.projectDir
    const projectJar = findJar(projectDir, undefined)
    const plan = planBackendLaunch({
      jarPath: this.config.jarPath,
      projectJar,
      jarUrl: this.config.jarUrl,
      hasGradlew: Boolean(gradleCommand(projectDir)),
    })

    if (plan.kind === 'error') {
      this.state = 'failed'
      this.giveUp = true
      this.message = plan.message ?? '未找到后端 jar'
      return { ...this.status(), started: false, waitedMs: 0 }
    }

    // 下载耗时不可预估，deadline 从 provisioning 完成后起算
    let cwd = projectDir
    let jar: string | undefined

    if (plan.kind === 'download') {
      this.state = 'starting'
      const dataDir = this.config.dataDir
      // 默认从 GitHub Release 下载 backend.jar，用户可用 jarUrl 覆盖
      const target = jarCachePath(dataDir, this.config.jarUrl ?? DEFAULT_JAR_URL)
      if (!jarCacheUsable(target)) {
        this.message = `正在下载后端（缓存于 ${dataDir}）…`
        try {
          await downloadFile(this.config.jarUrl ?? DEFAULT_JAR_URL, target, JAR_MAX_BYTES, (text) => { this.message = text })
        } catch (error) {
          this.state = 'failed'
          this.giveUp = true
          this.message = `后端 jar 下载失败：${error instanceof Error ? error.message : String(error)}（可改用 jarPath 本地 jar，或重试）`
          return { ...this.status(), started: false, waitedMs: 0 }
        }
      } else {
        this.message = '使用已缓存的后端 jar'
      }
      jar = target
      cwd = dataDir
      if (!existsSync(join(cwd, 'db', 'getjobs.db'))) {
        this.message = '正在下载 SQLite 模板库…'
        try {
          await downloadFile(this.config.dbUrl ?? DEFAULT_DB_URL, join(cwd, 'db', 'getjobs.db'), DB_MAX_BYTES)
        } catch (error) {
          this.state = 'failed'
          this.giveUp = true
          this.message = `数据库模板下载失败：${error instanceof Error ? error.message : String(error)}（可配置 dbUrl 或手动放置 db/getjobs.db）`
          return { ...this.status(), started: false, waitedMs: 0 }
        }
      }
    }

    const deadline = Date.now() + waitMs

    if (plan.kind === 'gradle') {
      const gradle = gradleCommand(projectDir)
      if (!gradle) {
        this.state = 'failed'
        this.giveUp = true
        this.message = `未找到可执行 jar 或 gradlew：${projectDir}`
        return { ...this.status(), started: false, waitedMs: 0 }
      }
      this.jarPath = undefined
      this.spawnProcess(projectDir, gradle.command, gradle.args, jdk, true)
    } else {
      jar = jar ?? projectJar ?? (this.config.jarPath ? findJar(projectDir, this.config.jarPath) : undefined)
      if (!jar) {
        this.state = 'failed'
        this.giveUp = true
        this.message = plan.message ?? '未找到后端 jar'
        return { ...this.status(), started: false, waitedMs: 0 }
      }
      this.jarPath = jar
      const java = process.platform === 'win32' ? join(jdk.home, 'bin', 'java.exe') : join(jdk.home, 'bin', 'java')
      // cwd 必须让 `jdbc:sqlite:./db/getjobs.db` 解析得到：源码模式用项目根，
      // 下载模式用 dataDir（db 模板已就位）。放 build/libs 下启动会找
      // build/libs/db/getjobs.db，直接启动失败。
      this.spawnProcess(cwd, java, this.jarArgs(plan.kind === 'download' ? cwd : projectDir, jar), jdk, false)
    }

    const ok = await this.waitHealthy(deadline)
    const waitedMs = waitMs - Math.max(0, deadline - Date.now())
    return { ...this.status(), started: ok, waitedMs }
  }

  /**
   * `java` 参数表。这几项在 `gradlew bootRun` 里由 build.gradle.kts 注入，
   * `java -jar` 时必须自己补上，否则 Playwright 会用 PATH 上的旧 Node 起驱动，
   * 报 `SyntaxError: Unexpected token '??='` 并让整个 Spring 上下文启动失败。
   */
  private jarArgs(projectDir: string, jar: string): string[] {
    const args = ['-Dfile.encoding=UTF-8', '-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8']
    const driver = join(projectDir, 'build', 'patchright-driver')
    if (existsSync(join(driver, 'package', 'cli.js'))) {
      args.push(`-Dplaywright.cli.dir=${driver}`)
    }
    args.push('-jar', jar)
    return args
  }

  private spawnProcess(cwd: string, command: string, args: string[], jdk: JdkInfo, shell: boolean): void {
    const node = detectNode()
    const logDir = join(tmpdir(), 'dsh-get-jobs')
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, `backend-${Date.now()}.log`)
    const fd = openSync(logPath, 'a')
    const port = new URL(this.config.baseUrl).port || '9527'

    let child: ChildProcess
    try {
      child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          JAVA_HOME: jdk.home,
          SERVER_PORT: port,
          // Playwright 的 Node 驱动必须是 18+；不显式指定就会用到 PATH 上的老版本
          ...(node ? { PLAYWRIGHT_NODEJS_PATH: node.path } : {}),
          PATH: `${join(jdk.home, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}`,
        },
        stdio: ['ignore', fd, fd],
        detached: true,
        windowsHide: true,
        shell,
      })
    } finally {
      closeSync(fd)
    }

    this.logPath = logPath
    this.child = child
    this.childPid = child.pid ?? undefined
    this.stopping = false

    child.once('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `exit ${code}`
      this.child = undefined
      this.childPid = undefined
      if (this.stopping) {
        this.state = 'unknown'
        this.message = `后端已停止（${detail}）`
        return
      }
      this.state = 'failed'
      this.refreshTail()
      const why = this.diagnosis()
      this.message = `后端进程意外退出（${detail}）` + (why ? `：${why}` : '')
      this.scheduleRestart()
    })
    child.once('error', (error) => {
      this.state = 'failed'
      this.message = `启动后端失败：${error.message}`
      this.child = undefined
      this.childPid = undefined
      this.scheduleRestart()
    })
    child.unref()

    this.state = 'starting'
    this.message = shell ? `正在启动（gradle）${command}` : `正在启动（jar）${this.jarPath}`
    // 写进宿主日志：出问题时能直接看到用了哪个 node、从哪个目录起的
    console.log(`[dsh-get-jobs] spawn pid=${this.childPid ?? '?'} cwd=${cwd} node=${node?.version ?? '未检测到'}`)
  }

  /**
   * Restart after an unexpected exit.
   *
   * The old build only started the backend once, on mount; if the JVM died the
   * panel kept showing "failed" until the app was restarted. Backoff is capped
   * at {@link MAX_RESTARTS} so a genuinely broken config does not spin forever.
   */
  private scheduleRestart(): void {
    if (this.giveUp || this.restartTimer) return
    if (this.restarts >= MAX_RESTARTS) {
      this.giveUp = true
      this.message += `；已重试 ${MAX_RESTARTS} 次，不再自动重启`
      return
    }
    const delay = restartDelay(this.restarts)
    this.restarts += 1
    this.message += `；${Math.round(delay / 1000)} 秒后第 ${this.restarts} 次自动重启`
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      void this.ensureRunning().catch(() => undefined)
    }, delay)
  }

  private async waitHealthy(deadline: number): Promise<boolean> {
    while (Date.now() < deadline) {
      if (await this.probe(1500)) {
        this.state = 'ready'
        this.message = '后端就绪'
        this.restarts = 0
        this.refreshTail()
        return true
      }
      if (!this.childPid && this.state === 'failed') {
        this.message = this.message || '后端启动失败'
        this.refreshTail()
        return false
      }
      await sleep(1000)
    }
    this.state = 'failed'
    this.message = `等待后端超时（${Math.round((deadline - Date.now()) / 1000)}s 剩余）`
    this.refreshTail()
    return false
  }

  /**
   * 从日志尾部挑一条能说明问题的行。
   *
   * 面板上只显示"exit 1"等于没说；真正的原因（Playwright 驱动、端口占用、
   * 数据库路径）都在日志里，取第一条命中即可。
   */
  private diagnosis(): string {
    const patterns = [
      /APPLICATION FAILED TO START/i,
      /SyntaxError/,
      /Port \d+ was already in use/i,
      /Caused by:/,
      /\bERROR\b/,
      /Exception/,
    ]
    for (const pattern of patterns) {
      const hit = this.tail.find((line) => pattern.test(line))
      if (hit) return hit.trim().slice(0, 220)
    }
    return ''
  }

  private refreshTail(): void {
    if (!this.logPath || !existsSync(this.logPath)) return
    try {
      const lines = redact(readFileSync(this.logPath, 'utf8')).split(/\r?\n/)
      this.tail = lines.slice(-MAX_LOG_LINES)
    } catch {
      // A missing or locked log is not fatal.
    }
  }

  /** Stop the process this plugin started. External backends are left alone. */
  stop(): BackendStatus {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    this.giveUp = true
    if (!this.childPid) {
      this.message = '当前没有由插件托管的后端进程'
      return this.status()
    }
    const pid = this.childPid
    this.stopping = true
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // Already gone.
        }
      }
    }
    this.childPid = undefined
    this.child = undefined
    this.state = 'unknown'
    this.message = `已停止后端进程（pid ${pid}）`
    console.log(`[dsh-get-jobs] stop pid=${pid}`)
    return this.status()
  }

  /** Release resources when the plugin unloads. */
  dispose(): void {
    if (this.childPid) this.stop()
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    this.giveUp = true
  }
}
