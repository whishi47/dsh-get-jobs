/**
 * Backend provisioning for machines without a backend checkout.
 *
 * The plugin manages a backend that the base project does not ship (the
 * plugin HTTP controllers live in this project), so on a fresh machine the jar
 * has to come from somewhere. Three sources, in priority order:
 *
 * 1. explicit `jarPath` config — points at any local jar
 * 2. a built jar in `<projectDir>/build/libs` — the developer layout
 * 3. `jarUrl` config — download once into the data dir, reuse afterwards
 *
 * Mode 3 is what makes a public install work: the only hard requirements left
 * are JDK 21 and one URL. The SQLite template (`dbUrl`) provisions the same
 * way, because the backend resolves `jdbc:sqlite:./db/getjobs.db` against its
 * working directory and an empty database has no tables.
 * @module dsh-get-jobs/backend/provision
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** Where jar/db downloads land when no project checkout exists. */
export function defaultDataDir(): string {
  const home = process.env['DSH_HOME'] || join(homedir(), '.dsh')
  return join(home, 'get-jobs')
}

/** SQLite template shipped with the project; override via the `dbUrl` config. */
export const DEFAULT_DB_URL = 'https://ghproxy.net/https://github.com/whishi47/dsh-get-jobs/releases/latest/download/getjobs.db.template'

/** Backend jar shipped as a GitHub release asset; override via the `jarUrl` config. */
export const DEFAULT_JAR_URL = 'https://ghproxy.net/https://github.com/whishi47/dsh-get-jobs/releases/latest/download/backend.jar'

/**
 * Gitee 镜像源：GitHub 拉不动（国内网络/代理问题）时作为备选。
 * 注意 Gitee 用具体 tag 路径，不使用 `latest`（Gitee 无此重定向）。
 * 需 Gitee Release `v0.1.0` 已上传对应资产后方能生效。
 */
export const DEFAULT_JAR_URL_GITEE = 'https://gitee.com/qiu-gaohua/dsh-get-jobs/releases/download/v0.1.0/backend.jar'
export const DEFAULT_DB_URL_GITEE = 'https://gitee.com/qiu-gaohua/dsh-get-jobs/releases/download/v0.1.0/getjobs.db.template'

/** Hard cap so a misconfigured URL cannot fill the disk. */
export const JAR_MAX_BYTES = 600 * 1024 * 1024
export const DB_MAX_BYTES = 64 * 1024 * 1024

/** Which launch strategy `planBackendLaunch` settled on. */
export type LaunchKind = 'jar' | 'gradle' | 'download' | 'error'

/** Decision input — everything the supervisor knows before spawning. */
export interface LaunchInput {
  /** Explicit `jarPath` config (absolute path), if any. */
  jarPath?: string
  /** Jar found in the project's `build/libs`, if any. */
  projectJar?: string
  /** `jarUrl` config, if any. */
  jarUrl?: string
  /** Whether the project directory carries a gradle wrapper. */
  hasGradlew: boolean
}

/** Decision output — what the supervisor should do next. */
export interface LaunchPlan {
  kind: LaunchKind
  /** For `error`: the user-facing remedy list. */
  message?: string
}

/**
 * Pure decision: how should this machine launch the backend?
 *
 * Order matters — a local jar always beats a download (no re-fetch for
 * developers), and gradle is the last resort because a cold build takes
 * minutes and needs the fork's source.
 */
export function planBackendLaunch(input: LaunchInput): LaunchPlan {
  if (input.jarPath) return { kind: 'jar' }
  if (input.projectJar) return { kind: 'jar' }
  if (input.jarUrl) return { kind: 'download' }
  if (input.hasGradlew) return { kind: 'gradle' }
  return {
    kind: 'error',
    message: '未找到后端 jar。三选一：① 插件配置 jarUrl 指向后端 jar 下载地址（首次启动自动下载）；② jarPath 指向本地 jar；③ 配置 projectDir 指向已构建的后端仓库',
  }
}

/** Cache file name for a downloaded jar (keeps the source file name). */
export function jarCachePath(dataDir: string, jarUrl: string): string {
  const name = basename(new URL(jarUrl).pathname) || 'backend.jar'
  return join(dataDir, name.endsWith('.jar') ? name : `${name}.jar`)
}

/** One redirect-following download with a size cap; atomic via temp + rename. */
export async function downloadFile(url: string, dest: string, maxBytes: number, onProgress?: (text: string) => void): Promise<void> {
  mkdirSync(join(dest, '..'), { recursive: true })
  const temp = `${dest}.part`
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(600_000),
    headers: { 'user-agent': 'dsh-get-jobs' },
  })
  if (!response.ok || !response.body) {
    response.body?.cancel()
    throw new Error(`HTTP ${response.status}：${url}`)
  }
  const total = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  let lastReport = 0
  const out = createWriteStream(temp)
  try {
    for await (const chunk of response.body) {
      received += chunk.length
      if (received > maxBytes) throw new Error(`下载超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限，已中止`)
      const now = Date.now()
      if (total && onProgress && now - lastReport > 1500) {
        lastReport = now
        onProgress(`正在下载 ${Math.round((received / total) * 100)}%（${(received / 1024 / 1024).toFixed(0)}/${(total / 1024 / 1024).toFixed(0)}MB）`)
      }
      out.write(Buffer.from(chunk))
    }
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject)
      out.end(() => resolve())
    })
    if (existsSync(dest)) renameSync(dest, `${dest}.bak`)
    renameSync(temp, dest)
  } finally {
    out.close()
  }
}

/** Cached jar present and non-trivial (guards against a truncated download). */
export function jarCacheUsable(path: string): boolean {
  try {
    return statSync(path).size > 1024 * 1024
  } catch {
    return false
  }
}
