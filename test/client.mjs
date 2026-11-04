/**
 * Browser-half test: load the real `lib/client.js`, register the slots against a
 * fake client context, mount the panel in jsdom, and walk every page.
 *
 * Two modes are exercised: backend unreachable (most pages fall back to empty
 * states) and backend "reachable" with failing endpoints (every page must still
 * render its error state). A render-time ReferenceError fails this test, which
 * is exactly what a build-only check cannot catch.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
let passes = 0
let failures = 0
function check(label, condition, detail) {
  if (condition) { passes += 1; console.log(`  ok   ${label}`) }
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ` → ${detail}` : ''}`) }
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:3080/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** jsdom has no EventSource; the Run page must not require one to render. */
class FakeEventSource {
  addEventListener() {}
  close() {}
}
dom.window.EventSource = FakeEventSource
globalThis.EventSource = FakeEventSource

const React = require('react')
const { createRoot } = require('react-dom/client')

console.log('\n[client bundle]')
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
check('以 ModuleLoader 注册且 id 与包名一致', code.includes('window.__ModuleLoader__.load({ id: "dsh-get-jobs"'))
check('React 保持 external', /require\("react(\/jsx-runtime)?"\)/.test(code))
check('未内联 React 实现', !/__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/.test(code))

let captured
dom.window.__ModuleLoader__ = { load: (entry) => { captured = entry } }
const shell = { exports: {} }
// eslint-disable-next-line no-new-func
new Function('window', 'require', 'module', 'exports', code)(dom.window, (id) => require(id), shell, shell.exports)
const client = captured.factory((id) => require(id))

console.log('\n[slot registration]')
const registrations = []
const disposers = []
const injectedSlots = []
const ctx = {
  inject: (deps, callback) => {
    if (!deps.includes('slots')) throw new Error('expected slots dependency')
    callback({
      effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
      slots: { register: (options, component) => { registrations.push({ options, component }); return () => {} } },
    })
  },
  // 新版 apply 走官方延迟注册姿势：ctx.slots.inject(slotName, factory)
  slots: {
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
    inject: (slotName, factory) => { injectedSlots.push(slotName); return factory() ?? (() => {}) },
  },
}
client.apply(ctx)
const mainEntry = registrations.find((item) => item.options.name === 'main')
const launcher = registrations.find((item) => item.options.name === 'sidebar.panellist')
check('注册 main 面板', mainEntry?.options.key === 'dsh-get-jobs')
check('注册侧边栏入口', launcher?.options.id === 'dsh-get-jobs')
check('侧边栏标签正确', launcher?.options.label === '求职投递')
// 必须走 slots.inject 延迟注册：立即 register 会在宿主声明 slot 前抢跑，
// web profile 实测报 "slot is not declared"（官方 plugin-manager 同款姿势）
check('走延迟注册（slots.inject）', injectedSlots.includes('main') && injectedSlots.includes('sidebar.panellist'))

/**
 * Mount the panel with a fetch stub and walk all six pages.
 *
 * `overrides` lets a case answer specific paths, which is how the "configured"
 * mode proves that code-valued fields actually resolve to names.
 */
async function walk(label, health, overrides = {}) {
  const originalFetch = globalThis.fetch
  const originalWarn = console.error
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/dsh-get-jobs/health')) {
      return { ok: true, json: async () => health }
    }
    for (const [fragment, body] of Object.entries(overrides)) {
      if (target.includes(fragment)) {
        return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
      }
    }
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) }
  }
  dom.window.fetch = globalThis.fetch
  console.error = () => {}

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let error
  try {
    await React.act(async () => { root.render(React.createElement(mainEntry.component)) })
  } catch (caught) {
    error = caught
  }
  check(`${label}：面板挂载不抛错`, error === undefined, error?.message)

  // 布局合同（对宿主 dsh-client-ui-layout 实测得出）：main slot 锚点是
  // display:contents，面板根节点是宿主 centerCol 的 flex item。
  // 禁止 position:absolute —— 其 containing block 是宿主 frame（含侧栏），
  // 会盖住整个窗口；必须是 flex:1 1 auto + min-height:0 才能拿到列高。
  const rootStyle = container.firstElementChild?.getAttribute('style') ?? ''
  check(`${label}：根节点布局合同（flex item 拿高度，禁 absolute）`,
    /position:\s*relative/.test(rootStyle)
      && /flex:\s*1 1 auto/.test(rootStyle)
      && /min-height:\s*0/.test(rootStyle)
      && !/position:\s*absolute/.test(rootStyle),
    rootStyle.slice(0, 120))

  const pages = ['概览', '投递配置', '运行', '数据', '简历', '设置']
  const seen = {}
  for (const page of pages) {
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === page)
    if (!button) {
      check(`${label}：找到 ${page} 入口`, false, `已渲染：${container.textContent?.slice(0, 60)}`)
      continue
    }
    let pageError
    try {
      await React.act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    } catch (caught) {
      pageError = caught
    }
    check(`${label}：${page} 页渲染不抛错`, pageError === undefined, pageError?.message)
    seen[page] = container.textContent ?? ''

    // 平台 tab 内容合同：投递配置页 Tabs 以下（含底部提示）必须包在独立滚动
    // 容器里（与设置页子 tab 同款），头部与 Tabs 固定
    if (page === '投递配置') {
      const scrollArea = [...container.querySelectorAll('div')].find((d) => {
        const style = d.getAttribute('style') ?? ''
        return /overflow:\s*auto/.test(style) && /flex:\s*1 1 auto/.test(style) && /min-height:\s*0/.test(style)
          && (d.textContent ?? '').includes('保存后将在下一次')
      })
      check(`${label}：平台 tab 内容在独立滚动容器内`, !!scrollArea)
    }
  }

  // 卡片收缩合同：Card 根节点带 overflow:hidden，若作为可收缩 flex item，
  // CSS 自动最小尺寸按 0 算 → 页面高度不够时卡片被压缩、内容被裁、永不滚动
  // （真实环境实测的裁剪根因）。所有卡片 section 必须flex-shrink:0
  const cardSections = [...container.querySelectorAll('section')]
  const badCards = cardSections.filter((s) => !/flex-shrink:\s*0/.test(s.getAttribute('style') ?? ''))
  check(`${label}：卡片禁止收缩（flex-shrink:0）`, cardSections.length === 0 || badCards.length === 0,
    badCards.length ? `${badCards.length}/${cardSections.length} 张卡片缺 flex-shrink:0` : '')

  await React.act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  console.error = originalWarn
  return seen
}

console.log('\n[backend unreachable]')
await walk('离线', {
  plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
  reachable: false, state: 'failed', managed: false, message: '未找到 JDK 21',
})

console.log('\n[backend reachable, endpoints failing]')
await walk('接口失败', {
  plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
  reachable: true, state: 'ready', managed: true, pid: 1234, message: '后端在线',
})

console.log('\n[backend healthy, configured]')
{
  // 码值必须解析成名字：配置里存的是 101280100 / 405 / 203，界面上要看到"深圳""20-30K""本科"
  const options = {
    city: [{ name: '深圳', code: '101280100' }, { name: '上海', code: '101020100' }],
    salary: [{ name: '20-30K', code: '405' }],
    degree: [{ name: '本科', code: '203' }],
    experience: [{ name: '3-5年', code: '105' }],
    industry: [{ name: '互联网', code: '100020' }],
    jobType: [{ name: '全职', code: '1901' }],
    scale: [{ name: '100-499人', code: '303' }],
    stage: [{ name: 'C轮', code: '805' }],
  }
  const seen = await walk('已配置', {
    plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
    reachable: true, state: 'ready', managed: true, pid: 4321, message: '后端在线',
  }, {
    '/api/boss/config': {
      config: { keywords: ['Java'], cityCode: ['101280100'], salary: ['405'], degree: ['203'], enableAi: 1, sayHi: '您好' },
      options,
    },
    // 后端 AiConfigController 返回 {success, data: aiEntity, message}，
    // 测试桩必须包一层 data，才能验证 aiProfile() 的解包逻辑
    '/api/ai/config': { success: true, data: { id: 1, introduce: '我是一名 Java 后端工程师', prompt: '写一句 30 字以内的开场白' }, message: '获取AI配置成功' },
    '/api/boss/config/blacklist': [],
  })

  const config = seen['投递配置'] ?? ''
  check('已配置：城市码解析成中文名', config.includes('深圳') && !config.includes('101280100'), config.slice(0, 200))
  check('已配置：薪资码解析成区间', config.includes('20-30K'), config.slice(0, 200))
  check('已配置：学历码解析成中文', config.includes('本科'), '')
  check('已配置：关键词回填', config.includes('Java'), '')
  // 设置页拆成内部 tab 后，AI 文案位于「AI 设置」子 tab，得切过去才能看到
  // walk() 内部已 unmount，这里独立 mount 一次面板
  const originalFetch2 = globalThis.fetch
  const originalWarn2 = console.error
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/dsh-get-jobs/health')) {
      return { ok: true, status: 200, json: async () => ({
        plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
        reachable: true, state: 'ready', managed: true, pid: 4321, message: '后端在线',
      }) }
    }
    if (target.includes('/api/ai/config')) {
      const body = { success: true, data: { id: 1, introduce: '我是一名 Java 后端工程师', prompt: '写一句 30 字以内的开场白' }, message: '获取AI配置成功' }
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
    }
    if (target.includes('/api/config')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }), json: async () => ({ success: true, data: {} }) }
    }
    if (target.includes('/api/boss/config/blacklist')) return { ok: true, status: 200, text: async () => '[]', json: async () => [] }
    if (target.includes('/api/system/ready')) return { ok: true, status: 200, text: async () => JSON.stringify({ ready: true, checks: [] }), json: async () => ({ ready: true, checks: [] }) }
    if (target.includes('/api/playwright/status')) return { ok: true, status: 200, text: async () => '{"initialized":false}', json: async () => ({ initialized: false }) }
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) }
  }
  dom.window.fetch = globalThis.fetch
  console.error = () => {}
  const c2 = document.createElement('div')
  document.body.appendChild(c2)
  const r2 = createRoot(c2)
  await React.act(async () => { r2.render(React.createElement(mainEntry.component)) })
  const settingsButton = [...c2.querySelectorAll('button')].find((node) => node.textContent?.trim() === '设置')
  await React.act(async () => { settingsButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 100)) })
  const aiTab = [...c2.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'AI 设置')
  if (aiTab) {
    await React.act(async () => { aiTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await React.act(async () => { await new Promise((done) => setTimeout(done, 60)) })
  }
  check('已配置：AI 配置可读', (c2.textContent ?? '').includes('我是一名 Java 后端工程师'), '')
  await React.act(async () => { r2.unmount() })
  c2.remove()
  globalThis.fetch = originalFetch2
  console.error = originalWarn2
}

console.log('\n[save uses string fields]')
{
  // BossConfigEntity 把 cityCode / salary / keywords 这些都声明成 String。
  // 发数组会让 Jackson 直接 400，整次保存失败——第一次真机保存踩的就是这个。
  const originalFetch = globalThis.fetch
  const originalWarn = console.error
  let putBody
  // 有状态的桩：PUT 会真的改掉 store，否则保存后重新拉取仍是旧值，
  // dirty 永远为真、"已保存"提示会被隐藏，测不出真实行为
  const store = {
    config: { keywords: ['Java'], cityCode: ['101280100'], salary: ['405'], degree: ['203'], enableAi: 1 },
    options: {
      city: [{ name: '深圳', code: '101280100' }, { name: '上海', code: '101020100' }],
      salary: [{ name: '20-30K', code: '405' }],
      degree: [{ name: '本科', code: '203' }],
    },
  }
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    if (target.includes('/dsh-get-jobs/health')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
          reachable: true, state: 'ready', managed: true, pid: 1, message: '后端在线',
        }),
      }
    }
    if (target.includes('/api/boss/config') && init?.method === 'PUT') {
      putBody = JSON.parse(String(init.body ?? '{}'))
      // 后端会把码转成名字再存回去，这里模拟同样的归一化
      const nameOf = (type, code) => (store.options[type] ?? []).find((item) => item.code === code)?.name ?? code
      for (const [key, type] of [['cityCode', 'city'], ['salary', 'salary'], ['degree', 'degree']]) {
        if (typeof putBody[key] === 'string') {
          const names = putBody[key].split(',').filter(Boolean).map((code) => nameOf(type, code))
          store.config[key] = type === 'cityCode' ? names : `[${names.join(',')}]`
        }
      }
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) }
    }
    if (target.includes('/api/boss/config')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(store), json: async () => store }
    }
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) }
  }
  dom.window.fetch = globalThis.fetch
  console.error = () => {}

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => { root.render(React.createElement(mainEntry.component)) })

  const configTab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '投递配置')
  await React.act(async () => { configTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 80)) })

  check('加载后不误报"有未保存改动"', !(container.textContent ?? '').includes('有未保存改动'), (container.textContent ?? '').slice(0, 120))

  // 删掉一个城市让表单变脏，再保存
  const removeChip = [...container.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') ?? '').startsWith('移除'))
  check('城市以中文名显示为可移除的标签', Boolean(removeChip), '未找到移除按钮')

  if (removeChip) {
    await React.act(async () => { removeChip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    const saveButton = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '保存')
    await React.act(async () => {
      saveButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((done) => setTimeout(done, 80))
    })
    check('保存发出了 PUT', putBody !== undefined, 'PUT 未触发')
    if (putBody) {
      const listy = ['cityCode', 'salary', 'degree', 'keywords']
      const wrong = listy.filter((key) => key in putBody && typeof putBody[key] !== 'string')
      check('列表字段以字符串提交（不是数组）', wrong.length === 0, `这些字段不是字符串：${wrong.join(',')} ${JSON.stringify(putBody)}`)
      check('整数字段仍是数字', typeof putBody.expectedSalaryMin !== 'object', JSON.stringify(putBody.expectedSalaryMin))
      const after = container.textContent ?? ''
      check('保存后出现"已保存"提示', after.includes('已保存'), after.slice(0, 160))
      check('提示说明何时生效', after.includes('下次启动投递时生效'), after.slice(0, 160))
      check('保存后不再提示"有未保存改动"', !after.includes('有未保存改动'), after.slice(0, 160))
    }
  }

  await React.act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  console.error = originalWarn
}

console.log('\n[boss: AI polish button + resume image upload entry]')
{
  // 用户要求：sayHi 旁边加 AI 润色按钮（调 GET /api/ai/chat），
  // sendImgResume 开关旁边加上传图片入口（调 POST /api/boss/config/resume-image）
  const originalFetch = globalThis.fetch
  const originalWarn = console.error
  let aiChatCalled = false
  let aiChatQuery = ''
  let imageUploadCalled = false
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    if (target.includes('/dsh-get-jobs/health')) {
      return { ok: true, status: 200, json: async () => ({
        plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
        reachable: true, state: 'ready', managed: true, pid: 1, message: '后端在线',
      }) }
    }
    if (target.includes('/api/boss/config/resume-image/content')) {
      // HEAD 探测：返回 404 表示没上传图片
      if (init?.method === 'HEAD') return { ok: false, status: 404 }
      return { ok: false, status: 404 }
    }
    if (target.includes('/api/boss/config/resume-image') && init?.method === 'POST') {
      imageUploadCalled = true
      return { ok: true, status: 200, json: async () => ({ success: true, message: 'ok', resumeImage: { exists: true, fileName: 'resume.png', contentType: 'image/png', size: 12345 } }) }
    }
    if (target.includes('/api/ai/chat')) {
      aiChatCalled = true
      aiChatQuery = target
      const body = { success: true, data: '您好，3年Java全栈，专注高并发与微服务落地。', message: 'ok' }
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
    }
    if (target.includes('/api/boss/config')) {
      const body = { config: { keywords: ['Java'], cityCode: ['101280100'], salary: ['405'], degree: ['203'], enableAi: 1, sayHi: '您好，我是Java工程师', sendImgResume: 1 }, options: { city: [{ name: '深圳', code: '101280100' }] } }
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
    }
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) }
  }
  dom.window.fetch = globalThis.fetch
  console.error = () => {}

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => { root.render(React.createElement(mainEntry.component)) })

  const configTab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '投递配置')
  await React.act(async () => { configTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 120)) })

  const text = () => container.textContent ?? ''

  // AI 润色按钮存在
  const polishButton = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'AI 润色')
  check('Boss：有 AI 润色按钮', Boolean(polishButton), text().slice(0, 200))

  // sayHi 文本框有初始值
  const sayHiTextarea = [...container.querySelectorAll('textarea')].find((node) => node.value?.includes('Java工程师'))
  check('Boss：sayHi 文本框有初始值', Boolean(sayHiTextarea))

  // 点击 AI 润色 → 调 GET /api/ai/chat → 回填
  if (polishButton && sayHiTextarea) {
    await React.act(async () => {
      polishButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((done) => setTimeout(done, 120))
    })
    check('Boss：AI 润色调用了 /api/ai/chat', aiChatCalled)
    const polished = [...container.querySelectorAll('textarea')].find((node) => node.value?.includes('高并发与微服务'))
    check('Boss：润色结果回填到 sayHi', Boolean(polished), text().slice(0, 200))
  }

  // 上传图片按钮存在
  const uploadButton = [...container.querySelectorAll('button')].find((node) => (node.textContent ?? '').includes('上传图片'))
  check('Boss：有上传图片按钮', Boolean(uploadButton), text().slice(0, 200))

  // sendImgResume 开关旁边有上传入口
  check('Boss：发送图片简历开关旁有上传入口', text().includes('上传图片') || text().includes('更换图片'), text().slice(0, 300))

  await React.act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  console.error = originalWarn
}

console.log('\n[login entry on the run page]')
{
  // 第一次用可能忘了登录，运行页必须能直接拉起源码扫码，而不是让用户去开别的东西
  const originalFetch = globalThis.fetch
  const originalWarn = console.error
  let triggered = false
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    if (target.includes('/dsh-get-jobs/health')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
          reachable: true, state: 'ready', managed: true, pid: 1, message: '后端在线',
        }),
      }
    }
    if (target.includes('/api/login/boss') && init?.method === 'POST') {
      triggered = true
      // JobsApi.call() 读的是 response.text()，测试桩必须把真实 body 放在这里
      const body = { platform: 'boss', accepted: true, message: '已切换到登录页' }
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
    }
    if (target.includes('/api/login/boss/status')) {
      return { ok: true, status: 200, json: async () => ({ platform: 'boss', isLoggedIn: false, initialized: true, opening: false }), text: async () => '{}' }
    }
    if (target.includes('/api/boss/status')) {
      return { ok: true, status: 200, json: async () => ({ isRunning: false, isLoggedIn: false }), text: async () => '{}' }
    }
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) }
  }
  dom.window.fetch = globalThis.fetch
  console.error = () => {}

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => { root.render(React.createElement(mainEntry.component)) })

  const runTab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '运行')
  await React.act(async () => { runTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 60)) })

  const buttons = [...container.querySelectorAll('button')].map((node) => node.textContent?.trim() ?? '')
  const loginButton = [...container.querySelectorAll('button')].find((node) => (node.textContent ?? '').includes('去登录') || (node.textContent ?? '').includes('去扫码登录'))
  check('运行页有扫码登录入口', Boolean(loginButton), buttons.join(' | ').slice(0, 160))

  if (loginButton) {
    await React.act(async () => {
      loginButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((done) => setTimeout(done, 80))
    })
    check('点击后调用了 /api/login/boss', triggered)
    await React.act(async () => { await new Promise((done) => setTimeout(done, 220)) })
    const after = container.textContent ?? ''
    check('点击后给出等待提示', after.includes('已切换到登录页') || after.includes('等待扫码'), after.slice(0, 200))
  }

  await React.act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  console.error = originalWarn
}

console.log('\n[settings: editable config, blacklist pagination & export]')
{
  // 用户反馈：密钥/URL/模型/推送必须可编辑，黑名单要能翻页和导出。
  // 这里用有状态的桩验证：改模型 → 保存走 POST /api/config；
  // 23 条黑名单 → 3 页、翻页内容变化；导出生成带 BOM 的 CSV；
  // 自定义键支持添加与删除（DELETE /api/config/{key}）。
  const originalFetch = globalThis.fetch
  const originalWarn = console.error
  // bundle 里的 Blob/URL 解析到 Node 全局（测试通过 new Function 注入），
  // 所以必须拦 globalThis.URL，拦 dom.window.URL 捕获不到
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalAnchorClick = dom.window.HTMLAnchorElement.prototype.click

  const configStore = {
    BASE_URL: 'https://api.deepseek.com',
    API_KEY: 'sk-test-123',
    MODEL: 'deepseek-chat',
    HOOK_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    BOT_IS_SEND: '1',
    EXTRA_KEY: 'hello',
  }
  const posts = []
  const deletes = []
  const blacklistRows = Array.from({ length: 23 }, (_, index) => ({
    id: index + 1, type: 'company', value: `测试公司${String(index + 1).padStart(2, '0')}`, createdAt: '2026-01-01 10:00:00',
  }))
  let exportBlob
  let exportName

  globalThis.fetch = async (url, init) => {
    const target = String(url)
    if (target.includes('/dsh-get-jobs/health')) {
      return {
        ok: true, status: 200, json: async () => ({
          plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
          reachable: true, state: 'ready', managed: true, pid: 1, message: '后端在线',
        }),
      }
    }
    if (target.includes('/api/config') && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body ?? '{}')))
      Object.assign(configStore, JSON.parse(String(init.body ?? '{}')))
      return { ok: true, status: 200, text: async () => '{"success":true}', json: async () => ({ success: true }) }
    }
    if (target.includes('/api/config') && init?.method === 'DELETE') {
      deletes.push(target)
      delete configStore['EXTRA_KEY']
      return { ok: true, status: 200, text: async () => '{"success":true}', json: async () => ({ success: true }) }
    }
    if (target.includes('/api/config')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: { ...configStore } }), json: async () => ({ success: true, data: { ...configStore } }) }
    }
    if (target.includes('/api/ai/config')) {
      const body = { success: true, data: { id: 1, introduce: '介绍', prompt: '提示词' }, message: 'ok' }
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
    }
    if (target.includes('/api/boss/config/blacklist')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(blacklistRows), json: async () => blacklistRows }
    }
    if (target.includes('/api/system/ready')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ ready: true, checks: [] }), json: async () => ({ ready: true, checks: [] }) }
    }
    if (target.includes('/api/playwright/status')) {
      return { ok: true, status: 200, text: async () => '{"initialized":false}', json: async () => ({ initialized: false }) }
    }
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) }
  }
  dom.window.fetch = globalThis.fetch
  console.error = () => {}
  URL.createObjectURL = (blob) => { exportBlob = blob; return 'blob:fake' }
  URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function () { exportName = this.download }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => { root.render(React.createElement(mainEntry.component)) })

  const settingsTab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '设置')
  await React.act(async () => { settingsTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 120)) })

  const text = () => container.textContent ?? ''

  // 改模型并保存：先切到「AI 设置」子 tab
  const aiSubTab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'AI 设置')
  await React.act(async () => { aiSubTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 120)) })

  const inputs = [...container.querySelectorAll('input')]
  const modelInput = inputs.find((node) => node.value === 'deepseek-chat')
  const keyInput = inputs.find((node) => node.type === 'password' && node.value === 'sk-test-123')
  check('设置：模型回填到输入框', Boolean(modelInput))
  check('设置：密钥以密码框回填', Boolean(keyInput))
  check('设置：显示 BASE_URL 表单', text().includes('BASE_URL'))
  check('设置：企业微信 webhook 表单', text().includes('HOOK_URL'))
  check('设置：AI 设置子 tab 含 introduce 标签', text().includes('自我介绍'))

  // 自定义键可见性需要切到「自定义配置」子 tab
  const customSubTab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '自定义配置')
  await React.act(async () => { customSubTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 60)) })
  // 此时 EXTRA_KEY 还未添加，先确认空状态正常显示；后续在这 tab 添加
  check('设置：自定义配置 tab 渲染不抛错', !text().includes('render 出错') && !text().includes('Application error'), text().slice(0, 160))

  // 黑名单分页：切到「黑名单」子 tab
  const blacklistSubTab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '黑名单')
  await React.act(async () => { blacklistSubTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 80)) })

  inputs.slice()
  // 模型字段在 AI 设置 tab 里，刚才已经切走过。这里回到 AI 设置 tab 改模型并保存
  await React.act(async () => { aiSubTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 80)) })
  const saveButtons = [...container.querySelectorAll('button')].filter((node) => node.textContent?.trim() === '保存' && !node.disabled)
  // 改模型让保存按钮可用
  if (modelInput) {
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await React.act(async () => {
      setValue.call(modelInput, 'deepseek-reasoner')
      modelInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const saveConnBtn = [...container.querySelectorAll('button')].filter((node) => node.textContent?.trim() === '保存' && !node.disabled)
    if (saveConnBtn[0]) {
      await React.act(async () => {
        saveConnBtn[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
        await new Promise((done) => setTimeout(done, 120))
      })
      check('设置：保存走 POST /api/config', posts.length > 0 && posts[0]['MODEL'] === 'deepseek-reasoner', JSON.stringify(posts))
      check('设置：保存包含全部核心键', posts[0] && ['BASE_URL', 'API_KEY', 'HOOK_URL', 'BOT_IS_SEND'].every((k) => k in posts[0]), JSON.stringify(posts[0] ?? {}))
      check('设置：保存后提示已保存', text().includes('已保存'), text().slice(0, 200))
    }
  }

  // 黑名单分页（切到黑名单 tab），需要等待列表加载
  await React.act(async () => { blacklistSubTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 100)) })
  check('黑名单：显示总条数', text().includes('23 条'), text().slice(0, 300))
  check('黑名单：分页控件出现', text().includes('第 1 / 3 页'), text().slice(0, 300))
  const removeButtonsPage1 = [...container.querySelectorAll('button')].filter((node) => node.textContent?.trim() === '移除')
  check('黑名单：首页只展示 10 条', removeButtonsPage1.length === 10, `实际 ${removeButtonsPage1.length}`)
  check('黑名单：首页含第 1 条', text().includes('测试公司01'))
  check('黑名单：首页不含第 11 条', !text().includes('测试公司11'))

  const nextButton = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '下一页')
  if (nextButton) {
    await React.act(async () => { nextButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await React.act(async () => { await new Promise((done) => setTimeout(done, 60)) })
    check('黑名单：翻页后显示第 2 页', text().includes('第 2 / 3 页'), text().slice(0, 300))
    check('黑名单：第 2 页含第 11 条', text().includes('测试公司11'))
    check('黑名单：第 2 页不含第 1 条', !text().includes('测试公司01'))
  } else {
    check('黑名单：找到下一页按钮', false)
  }

  // 导出 CSV：捕获 Blob 内容校验 BOM + 全量数据
  const exportButton = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('导出 CSV'))
  check('黑名单：有导出按钮', Boolean(exportButton))
  if (exportButton) {
    await React.act(async () => { exportButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    // blob.text() 按规范会剥离 BOM，必须读原始字节验证文件里真的带 BOM
    const bytes = exportBlob ? new Uint8Array(await exportBlob.arrayBuffer()) : new Uint8Array()
    const csv = new TextDecoder('utf-8').decode(bytes)
    check('导出：包含 BOM', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, Array.from(bytes.slice(0, 3)).join(','))
    check('导出：包含表头', csv.includes('id,类型,内容,添加时间'))
    check('导出：包含全部 23 条', (csv.match(/测试公司/g) ?? []).length === 23, `实际 ${(csv.match(/测试公司/g) ?? []).length}`)
    check('导出：文件名带日期', /^黑名单-\d{4}-\d{2}-\d{2}\.csv$/.test(exportName ?? ''), String(exportName))
  }

  // 自定义配置：先切到自定义 tab，再查 placeholder 元素
  await React.act(async () => { customSubTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 100)) })
  // 重新查 inputs，因为切 tab 后 visible 输入框不同
  const currentInputs = [...container.querySelectorAll('input')]
  const keyNameInput = currentInputs.find((node) => node.placeholder === '配置键，如 TIMEOUT_MS')
  const keyValueInput = currentInputs.find((node) => node.placeholder === '值')
  const addButton = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '添加')
  if (keyNameInput && keyValueInput && addButton) {
    const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await React.act(async () => {
      setValue.call(keyNameInput, 'TIMEOUT_MS')
      keyNameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      setValue.call(keyValueInput, '30000')
      keyValueInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await React.act(async () => {
      addButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((done) => setTimeout(done, 120))
    })
    check('自定义：添加发出 POST', posts.some((body) => body['TIMEOUT_MS'] === '30000'), JSON.stringify(posts))
  } else {
    check('自定义：找到添加入口', false)
  }

  const deleteButton = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '删除' && !node.disabled)
  if (deleteButton) {
    await React.act(async () => {
      deleteButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await new Promise((done) => setTimeout(done, 120))
    })
    check('自定义：删除走 DELETE /api/config/{key}', deletes.some((target) => target.includes('/api/config/EXTRA_KEY')), deletes.join(','))
  } else {
    check('自定义：找到删除按钮', false)
  }

  await React.act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  console.error = originalWarn
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  dom.window.HTMLAnchorElement.prototype.click = originalAnchorClick
}

console.log('\n[settings: inner tabs survive switches]')
{
  // 用户反馈：宿主面板滚不动整页长设置页，拆成内部 tab。
  // 这里验证：四个子 tab 都能点开、内容渲染、不抛错。
  const originalFetch = globalThis.fetch
  const originalWarn = console.error
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/dsh-get-jobs/health')) {
      return { ok: true, status: 200, json: async () => ({
        plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
        reachable: true, state: 'ready', managed: true, pid: 1, message: '后端在线',
      }) }
    }
    if (target.includes('/api/config')) return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: { BASE_URL: 'https://api.deepseek.com', API_KEY: 'sk-x', MODEL: 'deepseek-chat', HOOK_URL: 'https://qyapi.weixin.qq.com/cg', BOT_IS_SEND: '1' } }), json: async () => ({ success: true, data: { BASE_URL: 'https://api.deepseek.com', API_KEY: 'sk-x', MODEL: 'deepseek-chat', HOOK_URL: 'https://qyapi.weixin.qq.com/cg', BOT_IS_SEND: '1' } }) }
    if (target.includes('/api/ai/config')) return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: { id: 1, introduce: '介绍', prompt: '提示' }, message: 'ok' }), json: async () => ({ success: true, data: { id: 1, introduce: '介绍', prompt: '提示' }, message: 'ok' }) }
    if (target.includes('/api/boss/config/blacklist')) return { ok: true, status: 200, text: async () => '[]', json: async () => [] }
    if (target.includes('/api/system/ready')) return { ok: true, status: 200, text: async () => JSON.stringify({ ready: true, checks: [] }), json: async () => ({ ready: true, checks: [] }) }
    if (target.includes('/api/playwright/status')) return { ok: true, status: 200, text: async () => '{"initialized":false}', json: async () => ({ initialized: false }) }
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) }
  }
  dom.window.fetch = globalThis.fetch
  console.error = () => {}

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => { root.render(React.createElement(mainEntry.component)) })

  const settingsTab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === '设置')
  await React.act(async () => { settingsTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  await React.act(async () => { await new Promise((done) => setTimeout(done, 120)) })

  // 子 tab 标签出现
  for (const label of ['系统状态', 'AI 设置', '黑名单', '自定义配置']) {
    const tab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)
    check(`设置子 tab：${label} 可见`, Boolean(tab))
  }

  // 逐个切换并验证渲染不抛错
  for (const label of ['系统状态', 'AI 设置', '黑名单', '自定义配置']) {
    const tab = [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)
    let pageError
    try {
      await React.act(async () => { tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
      await React.act(async () => { await new Promise((done) => setTimeout(done, 40)) })
    } catch (caught) {
      pageError = caught
    }
    check(`设置子 tab：切到 ${label} 不抛错`, pageError === undefined, pageError?.message)
  }

  await React.act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  console.error = originalWarn
}

console.log('\n[starts after the panel is already open]')
{
  // 后端冷启动要 10-40 秒。面板必须先显示"正在启动"，然后自己发现它就绪，
  // 不能要求用户点刷新——这正是第一次真机运行时踩到的坑。
  const originalFetch = globalThis.fetch
  const originalWarn = console.error
  let healthCalls = 0
  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('/dsh-get-jobs/health')) {
      healthCalls += 1
      // 前两次仍未就绪，之后转为 ready
      const ready = healthCalls > 2
      return {
        ok: true,
        status: 200,
        json: async () => ({
          plugin: 'dsh-get-jobs', baseUrl: 'http://127.0.0.1:9527',
          reachable: ready, state: ready ? 'ready' : 'starting',
          managed: true, pid: 999, message: ready ? '后端在线' : '正在启动（jar）',
        }),
      }
    }
    if (target.includes('/api/boss/config')) {
      return {
        ok: true, status: 200,
        json: async () => ({ config: { keywords: ['Java'] }, options: { city: [{ name: '深圳', code: '101280100' }] } }),
        text: async () => '{}',
      }
    }
    return { ok: false, status: 503, text: async () => 'unavailable', json: async () => ({}) }
  }
  dom.window.fetch = globalThis.fetch
  console.error = () => {}

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => { root.render(React.createElement(mainEntry.component)) })

  const opening = container.textContent ?? ''
  check('启动中：显示正在启动', opening.includes('正在启动'), opening.slice(0, 120))

  // 轮询间隔 1.5s，等两轮足够跨过前两次未就绪
  await React.act(async () => { await new Promise((done) => setTimeout(done, 3600)) })

  const settled = container.textContent ?? ''
  check('就绪后：横幅自动消失', !settled.includes('正在启动') && !settled.includes('后端未启动'), settled.slice(0, 160))
  check('就绪后：确实轮询过', healthCalls >= 3, `healthCalls=${healthCalls}`)

  await React.act(async () => { root.unmount() })
  container.remove()
  globalThis.fetch = originalFetch
  console.error = originalWarn
}

for (const dispose of disposers) dispose()

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${passes} passed, ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
