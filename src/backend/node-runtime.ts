/**
 * Node runtime discovery for the Playwright driver.
 *
 * The Java backend drives Patchright through a Node child process. Patchright's
 * bundle uses modern syntax (`??=`, optional chaining), so it needs Node 18+.
 * When `PLAYWRIGHT_NODEJS_PATH` is absent Playwright falls back to `node` from
 * PATH — which on a machine with nvm installed can easily be a Node 12 that
 * dies with `SyntaxError: Unexpected token '??='` and takes the whole Spring
 * context down with it.
 *
 * `gradlew bootRun` sets this variable; a plain `java -jar` does not, so the
 * plugin has to set it itself.
 * @module dsh-get-jobs/backend/node-runtime
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** A Node binary usable as the Playwright driver runtime. */
export interface NodeInfo {
  path: string
  version: string
  source: 'host' | 'PATH' | 'scan'
}

/** Minimum version Patchright can run on. */
const MIN_MAJOR = 18

/** Read `major` out of `v22.22.2` style output. */
function majorOf(version: string): number {
  const match = version.trim().match(/^v?(\d+)/)
  return match?.[1] ? Number(match[1]) : 0
}

/** Probe one candidate; returns its version string when it runs. */
function probe(binary: string): string | undefined {
  if (!existsSync(binary)) return undefined
  try {
    const result = spawnSync(binary, ['-v'], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
    if (result.status !== 0) return undefined
    const version = (result.stdout ?? '').trim()
    return majorOf(version) >= MIN_MAJOR ? version : undefined
  } catch {
    return undefined
  }
}

/** Directories that commonly hold a Node install on Windows. */
function scanCandidates(): string[] {
  const found: string[] = []
  const direct = [
    join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
    join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'nvm', 'node.exe'),
    'C:\\nvm4w\\nodejs\\node.exe',
    'C:\\Program Files\\nodejs\\node.exe',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ]
  found.push(...direct.map((path) => path.replace(/\\/g, '\\')))

  // DSH 自带的运行时：一定是新版，且一定存在
  const runtimes = join(homedir(), '.dsh', 'dsh-runtimes')
  if (existsSync(runtimes)) {
    try {
      for (const entry of readdirSync(runtimes)) {
        found.push(join(runtimes, entry, 'dependencies', 'node', 'bin', 'node.exe'))
        found.push(join(runtimes, entry, 'dependencies', 'node', 'bin', 'node'))
      }
    } catch {
      // 读不到就跳过
    }
  }

  // nvm 多版本目录
  for (const root of ['C:\\nvm4w', join(homedir(), 'AppData', 'Roaming', 'nvm'), '/g/dev/nvm']) {
    if (!existsSync(root)) continue
    try {
      for (const entry of readdirSync(root)) {
        found.push(join(root, entry, 'node.exe'))
        found.push(join(root, entry, 'bin', 'node'))
      }
    } catch {
      // 同上
    }
  }
  return found
}

/**
 * Resolve a Node 18+ binary.
 *
 * Order matters: the host process itself is the most reliable source — DSH runs
 * on a recent Node, so `process.execPath` is both present and new enough.
 */
export function detectNode(): NodeInfo | undefined {
  // 1) 宿主进程自己（DSH 跑在 Node 22/24 上）
  const execPath = process.execPath
  if (/^node(\.exe)?$/i.test(basename(execPath))) {
    const version = probe(execPath)
    if (version) return { path: execPath, version, source: 'host' }
  }

  // 2) PATH 里的 node，必须过版本检查
  const fromPath = process.platform === 'win32' ? 'node.exe' : 'node'
  const pathed = scanPath(fromPath)
  if (pathed) {
    const version = probe(pathed)
    if (version) return { path: pathed, version, source: 'PATH' }
  }

  // 3) 已知安装位置
  for (const candidate of scanCandidates()) {
    const version = probe(candidate)
    if (version) return { path: candidate, version, source: 'scan' }
  }
  return undefined
}

/** Resolve one executable through PATH without spawning a shell. */
function scanPath(name: string): string | undefined {
  const dirs = (process.env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':')
  for (const dir of dirs) {
    const trimmed = dir.trim().replace(/^"|"$/g, '')
    if (!trimmed) continue
    const candidate = join(trimmed, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
