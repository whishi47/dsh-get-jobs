#!/usr/bin/env node
/**
 * Install-time safeguard for git-hosted installs (DSH runs `prepare` on
 * git plugins, but a pnpm workspace may block build scripts).
 *
 * The compiled `lib/` is shipped in the repository, so a normal install only
 * needs to verify the artifacts and exits immediately — no devDependencies,
 * no tsc/esbuild, no network. The build is attempted only if an artifact is
 * genuinely missing (e.g. a source checkout with lib/ removed).
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const required = ['lib/index.js', 'lib/index.d.ts', 'lib/client.js']
const missing = required.filter((file) => !existsSync(join(root, file)))

if (missing.length === 0) {
  console.log('[prepare] 预构建产物已随仓库发布，跳过构建')
  process.exit(0)
}

console.log(`[prepare] 缺少产物：${missing.join(', ')}，尝试重建 …`)
try {
  // 直接以当前 Node 运行构建脚本：Windows 上 spawnSync('npm.cmd') 会因 EINVAL
  // 失败（Node 20+ 禁止不带 shell 直接执行 .cmd），且无需依赖 npm 在 PATH 中。
  execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })
} catch (error) {
  console.error('[prepare] 构建失败：请确认已安装 devDependencies（typescript / esbuild），或手动执行 npm run build')
  throw error
}

const stillMissing = required.filter((file) => !existsSync(join(root, file)))
if (stillMissing.length > 0) {
  console.error(`[prepare] 构建后仍缺少：${stillMissing.join(', ')}`)
  process.exit(1)
}
console.log('[prepare] 构建完成')
