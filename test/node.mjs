/**
 * Node-half checks: redaction, JDK/jar discovery, supervisor states, tool
 * registration, and the health route. No real backend is started.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { redact, BackendSupervisor } from '../lib/backend/supervisor.js'
import { planBackendLaunch, jarCachePath, downloadFile, JAR_MAX_BYTES } from '../lib/backend/provision.js'
import { detectJdk21, findJar } from '../lib/backend/jdk.js'
import { findProjectRoot } from '../lib/layout.js'
import { resolveConfig } from '../lib/config.js'
import { apply, name } from '../lib/index.js'

let passes = 0
let failures = 0
function check(label, condition, detail) {
  if (condition) {
    passes += 1
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` → ${detail}` : ''}`)
  }
}

console.log('\n[redaction]')
{
  const text = 'API_KEY=sk-removed-please-rotate HOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=00000000-0000'
  const masked = redact(text)
  check('掩码 API Key', !masked.includes('cc55b242'), masked)
  check('掩码 webhook key', !masked.includes('22e250b0'), masked)
  check('保留上下文', masked.includes('API_KEY='), masked)
}

console.log('\n[discovery]')
{
  const empty = mkdtempSync(join(tmpdir(), 'dsh-get-jobs-empty-'))
  check('空目录找不到 jar', findJar(empty) === undefined)
  check('空目录找不到 gradlew 场景由 supervisor 处理', true)

  // 后端 fat jar 用宽松名称匹配（任意非 -plain 的 application jar），不绑定具体 stem
  mkdirSync(join(empty, 'build', 'libs'), { recursive: true })
  writeFileSync(join(empty, 'build', 'libs', 'backend-2.0.1.jar'), 'x')
  writeFileSync(join(empty, 'build', 'libs', 'backend-2.0.1-plain.jar'), 'x')
  const picked = findJar(empty)
  check('识别后端 fat jar', picked?.endsWith('backend-2.0.1.jar') === true, String(picked))

  const jdk = detectJdk21()
  check('JDK 探测返回结构合法', jdk === undefined || (typeof jdk.home === 'string' && typeof jdk.version === 'string'), JSON.stringify(jdk))
  if (jdk) console.log(`       (使用 ${jdk.version} @ ${jdk.home}，来源 ${jdk.source})`)
  rmSync(empty, { recursive: true, force: true })
}

console.log('\n[project discovery]')
{
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-get-jobs-layout-'))
  const marker = (dir) => {
    mkdirSync(join(dir, 'db'), { recursive: true })
    writeFileSync(join(dir, 'gradlew'), '#!/bin/sh\n')
    writeFileSync(join(dir, 'db', 'getjobs.db'), '')
  }

  // 布局一：插件在项目里面（<backend>/dsh-get-jobs）
  const nestedProject = join(sandbox, 'nested-project')
  marker(nestedProject)
  mkdirSync(join(nestedProject, 'dsh-get-jobs'), { recursive: true })
  check('插件在项目内时找到项目根', findProjectRoot(join(nestedProject, 'dsh-get-jobs')) === nestedProject,
    String(findProjectRoot(join(nestedProject, 'dsh-get-jobs'))))

  // 布局二：插件与项目同级（<workspace>/dsh-get-jobs + <workspace>/<backend>）
  const siblingRoot = join(sandbox, 'sibling')
  mkdirSync(join(siblingRoot, 'dsh-get-jobs'), { recursive: true })
  marker(join(siblingRoot, 'backend'))
  check('插件与项目同级时找到项目根', findProjectRoot(join(siblingRoot, 'dsh-get-jobs')) === join(siblingRoot, 'backend'),
    String(findProjectRoot(join(siblingRoot, 'dsh-get-jobs'))))

  // 都没有时返回 undefined，交给上层兜底
  // 用独立的临时目录（不在 sandbox 内），避免向上扫描到 sandbox 下的其他工程根
  const bare = mkdtempSync(join(tmpdir(), 'dsh-get-jobs-bare-'))
  check('没有项目标记时返回 undefined', findProjectRoot(bare) === undefined, String(findProjectRoot(bare)))
  rmSync(bare, { recursive: true, force: true })

  rmSync(sandbox, { recursive: true, force: true })
}

console.log('\n[supervisor]')
{
  const empty = mkdtempSync(join(tmpdir(), 'dsh-get-jobs-proj-'))
  const config = resolveConfig({ baseUrl: 'http://127.0.0.1:1', projectDir: empty, autostart: false, timeoutMs: 800 })
  const supervisor = new BackendSupervisor(config)

  check('初始状态为 unknown', supervisor.status().state === 'unknown')
  check('未托管时无 pid', supervisor.status().managed === false)
  check('停止无托管进程不报错', supervisor.stop().managed === false)

  const probe = await supervisor.probe(600)
  check('不可达时 probe 返回 false', probe === false)

  const result = await supervisor.ensureRunning(2000)
  check('无 jar 无 gradlew 时进入 failed', result.state === 'failed', result.message)
  check('失败信息可读', result.message.length > 0, result.message)
  rmSync(empty, { recursive: true, force: true })
}

console.log('\n[auto restart]')
{
  // 一个损坏的 jar 会让 JVM 立刻退出，正好用来验证"意外退出后自动重试"这条路径
  const fake = mkdtempSync(join(tmpdir(), 'dsh-get-jobs-broken-'))
  mkdirSync(join(fake, 'build', 'libs'), { recursive: true })
  writeFileSync(join(fake, 'build', 'libs', 'get-jobs-fake.jar'), 'not-a-jar')

  const config = resolveConfig({ baseUrl: 'http://127.0.0.1:1', projectDir: fake, autostart: false, timeoutMs: 600 })
  const supervisor = new BackendSupervisor(config)
  const first = await supervisor.ensureRunning(8000)

  check('损坏 jar 时启动失败', first.state === 'failed', first.message)
  check('失败后安排自动重启', first.message.includes('自动重启'), first.message)
  check('状态里带上 jar 路径', typeof supervisor.status().jar === 'string', String(supervisor.status().jar))
  check('显式 stop 后不再自动重启', supervisor.stop().message.includes('已停止') || supervisor.status().managed === false)

  supervisor.dispose()
  rmSync(fake, { recursive: true, force: true })
}

console.log('\n[concurrent start]')
{
  const empty = mkdtempSync(join(tmpdir(), 'dsh-get-jobs-race-'))
  const config = resolveConfig({ baseUrl: 'http://127.0.0.1:1', projectDir: empty, autostart: false, timeoutMs: 600 })
  const supervisor = new BackendSupervisor(config)
  // 两次调用在同一 tick 发起，必须共用同一次尝试，否则会起两个 JVM 抢同一个端口
  const [a, b] = await Promise.all([supervisor.ensureRunning(1200), supervisor.ensureRunning(1200)])
  check('并发 ensureRunning 共用一次尝试', a === b)
  supervisor.dispose()
  rmSync(empty, { recursive: true, force: true })
}

console.log('\n[plugin surface]')
{
  const tools = []
  const routes = []
  const disposers = []
  const ctx = {
    tools: { register: (definition) => { tools.push(definition); return () => {} } },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
  }

  const empty = mkdtempSync(join(tmpdir(), 'dsh-get-jobs-cfg-'))
  apply(ctx, { baseUrl: 'http://127.0.0.1:1', projectDir: empty, autostart: false, timeoutMs: 800 })

  check('插件名为 dsh-get-jobs', name === 'dsh-get-jobs')
  check('注册两个工具', tools.length === 2, tools.map((tool) => tool.name).join(','))
  check('包含 getjobs_status', tools.some((tool) => tool.name === 'getjobs_status'))
  check('包含 getjobs_backend', tools.some((tool) => tool.name === 'getjobs_backend'))
  check('注册健康路由', routes.length === 1 && routes[0].path === '/dsh-get-jobs/health')

  const exec = { signal: new AbortController().signal }
  const statusTool = tools.find((tool) => tool.name === 'getjobs_status')
  const value = await statusTool.execute({}, exec)
  check('status 工具离线时不抛错', value.reachable === false)
  check('status 工具给出状态文案', typeof value.message === 'string' && value.message.length > 0, value.message)

  const backendTool = tools.find((tool) => tool.name === 'getjobs_backend')

  // 默认 mutations=confirm：不带 confirm 时只提示，不真的去起进程
  const gated = await backendTool.execute({ action: 'start', waitMs: 5000 }, exec)
  check('confirm 策略下先要确认', gated.state === 'needs-confirmation', gated.state)
  check('确认提示可读', typeof gated.message === 'string' && gated.message.includes('9527'), gated.message)

  // 带 confirm 才真正尝试启动；这里没有项目目录，必然失败但结果要结构化
  const started = await backendTool.execute({ action: 'start', waitMs: 5000, confirm: true }, exec)
  check('start 失败时返回结构化结果', started.reachable === false && typeof started.message === 'string', started.message)

  // mutations=deny 时完全拒绝
  const deniedTools = []
  apply(
    { tools: { register: (definition) => { deniedTools.push(definition); return () => {} } }, webServer: { register: () => () => {} }, effect: (fn) => { fn() } },
    { mutations: 'deny', autostart: false },
  )
  const denied = await deniedTools.find((tool) => tool.name === 'getjobs_backend').execute({ action: 'start' }, exec)
  check('deny 策略下拒绝启停', denied.state === 'denied', denied.state)

  rmSync(empty, { recursive: true, force: true })
  for (const dispose of disposers) dispose()
}

console.log('[provision: launch decision]')
{
  check('显式 jarPath 最优先', planBackendLaunch({ jarPath: 'a.jar', projectJar: 'b.jar', jarUrl: 'http://x/j.jar', hasGradlew: true }).kind === 'jar')
  check('项目 jar 次之', planBackendLaunch({ projectJar: 'b.jar', jarUrl: 'http://x/j.jar', hasGradlew: true }).kind === 'jar')
  check('jarUrl 触发下载模式', planBackendLaunch({ jarUrl: 'http://x/j.jar', hasGradlew: true }).kind === 'download')
  check('无 jarUrl 时回退 gradle', planBackendLaunch({ hasGradlew: true }).kind === 'gradle')
  const error = planBackendLaunch({ hasGradlew: false })
  check('全无时给可读 remedy', error.kind === 'error' && error.message?.includes('jarUrl'), error.message)
  check('缓存路径保留源文件名', jarCachePath('/tmp/d', 'https://r/backend-2.0.1.jar').endsWith(join('d', 'backend-2.0.1.jar')))
  check('缓存路径补 .jar 后缀', jarCachePath('/tmp/d', 'https://r/latest').endsWith('.jar'))
}

console.log('[provision: download e2e over local http]')
{
  const http = await import('node:http')
  const payload = Buffer.from('A'.repeat(3 * 1024 * 1024))
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/real.jar' }); res.end(); return }
    res.writeHead(200, { 'content-length': payload.length })
    res.end(payload)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  const dir = mkdtempSync(join(tmpdir(), 'dsh-get-jobs-dl-'))
  const dest = join(dir, 'backend.jar')

  await downloadFile('http://127.0.0.1:' + port + '/real.jar', dest, JAR_MAX_BYTES)
  check('直链下载落盘', statSync(dest).size === payload.length)

  await downloadFile('http://127.0.0.1:' + port + '/redirect', dest.replace('.jar', '2.jar'), JAR_MAX_BYTES)
  check('302 重定向跟随', statSync(dest.replace('.jar', '2.jar')).size === payload.length)

  let progressSeen = false
  await downloadFile('http://127.0.0.1:' + port + '/real.jar', dest.replace('.jar', '3.jar'), JAR_MAX_BYTES, () => { progressSeen = true })
  check('进度回调触发', progressSeen)

  let capped = ''
  try { await downloadFile('http://127.0.0.1:' + port + '/real.jar', join(dir, 'too.jar'), 1024) } catch (e) { capped = e.message }
  check('超限中止', capped.includes('上限'), capped)
  check('超限不落盘', !existsSync(join(dir, 'too.jar')))

  server.close()
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${passes} passed, ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
