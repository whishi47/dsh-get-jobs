#!/usr/bin/env node
/**
 * Consistency gates: package name, patch row, exports, runtime dependencies,
 * and shipped artifacts must agree. Mirrors the DSH plugin contracts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const results = []

/** The browser half may be named .ts or .tsx. */
function clientSourceExists() {
  return ['index.tsx', 'index.ts'].some((file) => existsSync(join(root, 'src', 'client', file)))
}

function check(label, fn) {
  try {
    results.push({ ok: true, label, detail: fn() })
  } catch (error) {
    results.push({ ok: false, label, detail: error instanceof Error ? error.message : String(error) })
  }
}

check('package.json 基础字段', () => {
  if (pkg.type !== 'module') throw new Error('type 必须为 module')
  if (pkg.main !== 'lib/index.js') throw new Error('main 必须为 lib/index.js')
  if (pkg.exports['.'] !== './lib/index.js') throw new Error("exports['.'] 必须为 ./lib/index.js")
  if (!pkg.exports['./package.json']) throw new Error("exports['./package.json'] 缺失")
  return pkg.name
})

check('bundle 合同', () => {
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('dsh.bundle.patch 缺失')
  if (pkg.exports['./cordis.patch.yml'] !== './cordis.patch.yml') throw new Error('patch 未导出')
  if (!existsSync(join(root, 'cordis.patch.yml'))) throw new Error('cordis.patch.yml 不存在')
  return 'bundle 层就绪'
})

check('名称一致性（package / patch id / patch name）', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const declared = [...patch.matchAll(/(id|name):\s*(\S+)/g)].map((match) => match[2].replace(/['"]/g, ''))
  const mismatch = declared.filter((value) => value !== pkg.name)
  if (mismatch.length > 0) throw new Error(`与包名不一致：${mismatch.join(', ')}`)
  return `${pkg.name} 一致`
})

check('禁止 @deepseek-ai/* 运行时依赖', () => {
  const offenders = []
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (dep.startsWith('@deepseek-ai/')) offenders.push(`${field}:${dep}`)
    }
  }
  if (offenders.length > 0) throw new Error(offenders.join(', '))
  return '运行时依赖干净'
})

check('构建产物存在', () => {
  if (!existsSync(join(root, 'lib/index.js'))) throw new Error('lib/index.js 缺失，先跑 npm run build')
  if (clientSourceExists() && !existsSync(join(root, 'lib/client.js'))) {
    throw new Error('src/client 存在但 lib/client.js 缺失')
  }
  return 'lib 完整'
})

check('client 合同（仅在存在浏览器半边时校验）', () => {
  if (!clientSourceExists()) return '本期暂无浏览器半边'
  if (pkg.dsh?.client?.platform !== 'web') throw new Error('dsh.client.platform 必须为 web')
  if (pkg.exports['./client'] !== './lib/client.js') throw new Error("exports['./client'] 必须为 ./lib/client.js")
  const body = readFileSync(join(root, 'lib/client.js'), 'utf8')
  if (!body.includes(`window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}`)) {
    throw new Error('ModuleLoader id 与包名不一致')
  }
  if (!/require\("react(\/jsx-runtime)?"\)/.test(body)) throw new Error('React 未保持 external')
  return 'client 合同通过'
})

check('README 覆盖安装与配置', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  for (const keyword of ['dsh plugin', 'cordis.patch.yml', 'javaHome']) {
    if (!readme.includes(keyword)) throw new Error(`README 缺少「${keyword}」`)
  }
  return 'README 完整'
})

for (const result of results) {
  console.log(`  [${result.ok ? 'PASS' : 'FAIL'}] ${result.label}${result.detail ? ` — ${result.detail}` : ''}`)
}
const failed = results.filter((item) => !item.ok).length
console.log(`\n[gates] ${failed === 0 ? 'PASSED' : `FAILED: ${failed}/${results.length}`}`)
process.exit(failed === 0 ? 0 : 1)
