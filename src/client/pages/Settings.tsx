/**
 * Settings: four inner tabs (system/AI/blacklist/custom) so each view stays
 * short and scrolls inside its own container.
 *
 * Scrolling contract (verified against dsh-client-ui-layout source): the main
 * slot anchor is display:contents, so the panel root is the host center
 * column's flex item and gets a definite height via flex:1 + min-height:0.
 * This page relies on that chain: pageStyle → tabContentStyle each carry
 * min-height:0 + overflow:auto.
 * @module dsh-get-jobs/client/pages/settings
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { Badge, Button, Card, Empty, ErrorState, Field, Icon, Input, Skeleton, Spacer, Tabs, Textarea, Toggle } from '../components.js'
import { useBackend, useResource } from '../hooks.js'
import { pageStyle, tokens } from '../theme.js'

/** One readiness probe returned by `GET /api/system/ready`. */
interface ReadyCheck {
  id: string
  label: string
  ok: boolean
  message: string
  detail?: Record<string, unknown>
}

/** Payload of `GET /api/system/ready`. */
interface ReadyPayload {
  ready: boolean
  checks: ReadyCheck[]
  projectDir?: string
}

/** Keys the delivery pipeline depends on — editable but not deletable. */
const CORE_KEYS = ['BASE_URL', 'API_KEY', 'MODEL', 'HOOK_URL', 'BOT_IS_SEND'] as const

/** Blacklist page size; long lists made the settings page unusable. */
const BLACKLIST_PAGE_SIZE = 10

/**
 * AI 成本相关的配置键。
 *
 * 和 CORE_KEYS 分开：核心键决定"能不能调通模型"，这几个决定"会不会把账单跑爆"。
 * 值为空时后端会用自己的默认值（单次运行 30 次 / 每日 300 次 / 单次输出 300 token）。
 */
const AI_COST_KEYS = [
  'AI_RUN_LIMIT',
  'AI_DAILY_LIMIT',
  'AI_MAX_TOKENS',
  'AI_GREETING_BATCH',
  'AI_GREETING_POOL',
  'AI_SKIP_MISMATCH',
  'AI_THINKING_MODE',
] as const

/** 思考模式三档；off 最省，high 最贵。 */
const THINKING_MODES: Array<{ value: 'off' | 'auto' | 'high'; label: string; hint: string }> = [
  { value: 'off', label: '关闭', hint: '不产生思考 token，最省' },
  { value: 'auto', label: '自动', hint: '跟随模型默认行为' },
  { value: 'high', label: '深度', hint: '让模型多想，输出 token 明显增加' },
]

/** 池化开关缺省为开：老库里没有这个键时也要按省钱模式跑。 */
const AI_POOL_DEFAULT = '1'

/**
 * 推荐提示词：明确 80-120 字，并要求「技术栈 + 真实成果 + 求职意向」三段式。
 *
 * <p>写死在面板上是为了让用户随时能一键回填 —— 提示词被改短过之后，
 * 生成的招呼语就会一直很短，而用户很难意识到问题出在这一栏。
 */
const RECOMMENDED_GREETING_PROMPT = [
  '你是求职者本人，请根据岗位 JD 写一段发给 HR 的开场白，要求：',
  '1. 长度 80-120 个汉字，2-3 句，不要分段；',
  '2. 第一句点明与该岗位最匹配的 1-2 项技术栈或业务经验（从 JD 里挑，不要罗列）；',
  '3. 第二句用自我介绍里真实存在的成果支撑，尽量带数字或规模（并发量、QPS、数据量、团队人数），没有数字就用具体职责代替，不得编造；',
  '4. 最后一句表达求职意向与沟通意愿；',
  '5. 不要出现公司名、岗位名称，不要写「您好」这类开场寒暄（系统会在前面拼一段固定开头），不要堆客套话，不要 emoji；',
  '6. 只输出消息正文，不要标题、引号或解释。',
].join('\n')

/** Inner tabs — one per concern, each fits a screen without scrolling. */
type SettingsTab = 'system' | 'ai' | 'blacklist' | 'custom' | 'backup'

const TAB_ITEMS: Array<{ value: SettingsTab; label: string }> = [
  { value: 'system', label: '系统状态' },
  { value: 'ai', label: 'AI 设置' },
  { value: 'blacklist', label: '黑名单' },
  { value: 'custom', label: '自定义配置' },
  { value: 'backup', label: '备份与报表' },
]

/** One number tile in the AI usage card. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: tokens.radius.md,
      border: `1px solid ${tokens.color.border}`,
      background: tokens.color.surface,
    }}>
      <div style={{ fontSize: tokens.font.xs, color: tokens.color.textMuted }}>{label}</div>
      <div style={{ fontSize: tokens.font.lg, fontWeight: 700, marginTop: 2 }}>{value}</div>
      {hint ? <div style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint, marginTop: 2 }}>{hint}</div> : null}
    </div>
  )
}

/** `12345` → `12,345`; missing values render as `0`. */
function formatNumber(value: number | undefined): string {
  return Number(value ?? 0).toLocaleString('zh-CN')
}

/** Escape one CSV cell; quotes are doubled per RFC 4180. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Settings surface. */
export function Settings(): React.ReactElement {
  const backend = useBackend()
  const api = backend.api
  const [activeTab, setActiveTab] = useState<SettingsTab>('system')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // ----------------------------------------------------------------- 诊断信息
  // 诊断声明提前：saveConn 里要 reload ready，避免 TDZ
  const ready = useResource(
    async () => {
      if (!api) return undefined
      const response = await fetch(`${api.baseUrl}/api/system/ready`)
      return response.ok ? await response.json() as ReadyPayload : undefined
    },
    [backend.revision, api?.baseUrl],
  )
  const browser = useResource(
    async () => {
      if (!api) return undefined
      const response = await fetch(`${api.baseUrl}/api/playwright/status`)
      return response.ok ? await response.json() as Record<string, unknown> : undefined
    },
    [backend.revision, api?.baseUrl],
  )

  // ------------------------------------------------------------------- AI 文案
  const profile = useResource(
    async () => (api ? api.aiProfile() : undefined),
    [backend.revision, api?.baseUrl],
  )
  const [aiForm, setAiForm] = useState<{ introduce: string; prompt: string }>({ introduce: '', prompt: '' })
  // 固定开头存在 config 表（GREETING_PREFIX），不属于 ai 表，单独保存
  const [prefixForm, setPrefixForm] = useState<string | undefined>(undefined)
  const [prefixNotice, setPrefixNotice] = useState<string | undefined>(undefined)
  const [aiSaved, setAiSaved] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!profile.data) return
    setAiForm({ introduce: profile.data.introduce ?? '', prompt: profile.data.prompt ?? '' })
  }, [profile.data])

  const aiDirty = Boolean(profile.data) && (
    aiForm.introduce !== (profile.data?.introduce ?? '') || aiForm.prompt !== (profile.data?.prompt ?? '')
  )

  async function savePrefix(): Promise<void> {
    if (!api) return
    setBusy(true)
    setPrefixNotice(undefined)
    try {
      await api.saveAppConfig({ GREETING_PREFIX: prefixForm ?? '' })
      setPrefixNotice('已保存，下次投递生效')
      appConfig.reload()
    } catch (caught) {
      setPrefixNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function saveAi(): Promise<void> {
    if (!api) return
    setBusy(true)
    setError(undefined)
    try {
      await api.saveAiProfile(aiForm.introduce, aiForm.prompt)
      setAiSaved(new Date().toLocaleTimeString('zh-CN'))
      profile.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------------- 接口与推送（可编辑）
  const appConfig = useResource(
    async () => (api ? api.appConfig() : undefined),
    [backend.revision, api?.baseUrl],
  )
  const [connForm, setConnForm] = useState<Record<string, string>>({})
  const [showKey, setShowKey] = useState(false)
  const [connSaved, setConnSaved] = useState<string | undefined>(undefined)

  // 固定开头从配置表回填；必须放在 appConfig 声明之后，否则渲染时是 TDZ
  useEffect(() => {
    if (appConfig.data && prefixForm === undefined) {
      setPrefixForm(appConfig.data['GREETING_PREFIX'] ?? '')
    }
  }, [appConfig.data, prefixForm])

  useEffect(() => {
    if (!appConfig.data) return
    const next: Record<string, string> = {}
    for (const key of CORE_KEYS) next[key] = appConfig.data[key] ?? ''
    setConnForm(next)
  }, [appConfig.data])

  const connDirty = Boolean(appConfig.data) && CORE_KEYS.some(
    (key) => (connForm[key] ?? '') !== (appConfig.data?.[key] ?? ''),
  )

  async function saveConn(): Promise<void> {
    if (!api) return
    setBusy(true)
    setError(undefined)
    try {
      const patch: Record<string, string> = {}
      for (const key of CORE_KEYS) patch[key] = connForm[key] ?? ''
      await api.saveAppConfig(patch)
      setConnSaved(new Date().toLocaleTimeString('zh-CN'))
      appConfig.reload()
      ready.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------------------ AI 用量与预算
  const usage = useResource(
    async () => (api ? api.aiUsage() : undefined),
    [backend.revision, api?.baseUrl],
  )
  const [costForm, setCostForm] = useState<Record<string, string>>({})
  const [costSaved, setCostSaved] = useState<string | undefined>(undefined)

  /** 某个成本键的"已保存值"；池化开关缺省为开。 */
  function costBaseline(key: string): string {
    const stored = appConfig.data?.[key]
    if (stored !== undefined && stored !== '') return stored
    if (key === 'AI_GREETING_POOL') return AI_POOL_DEFAULT
    // 岗位匹配过滤默认关闭：它会给每个岗位多一次调用
    if (key === 'AI_SKIP_MISMATCH') return '0'
    // 默认关闭思考：与后端 AI_DISABLE_THINKING=true 的既有行为保持一致
    if (key === 'AI_THINKING_MODE') return 'off'
    return ''
  }

  useEffect(() => {
    if (!appConfig.data) return
    const next: Record<string, string> = {}
    for (const key of AI_COST_KEYS) next[key] = costBaseline(key)
    setCostForm(next)
  }, [appConfig.data])

  const costDirty = Boolean(appConfig.data)
    && AI_COST_KEYS.some((key) => (costForm[key] ?? '') !== costBaseline(key))

  async function saveCost(): Promise<void> {
    if (!api) return
    setBusy(true)
    setError(undefined)
    try {
      const patch: Record<string, string> = {}
      for (const key of AI_COST_KEYS) patch[key] = costForm[key] ?? costBaseline(key)
      await api.saveAppConfig(patch)
      setCostSaved(new Date().toLocaleTimeString('zh-CN'))
      appConfig.reload()
      usage.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------------------ 备份与报表
  const report = useResource(
    async () => (api ? api.dailyReport() : undefined),
    [backend.revision, api?.baseUrl],
  )
  const [backupNotice, setBackupNotice] = useState<string | undefined>(undefined)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [reportForm, setReportForm] = useState<Record<string, string> | undefined>(undefined)
  const [reportPending, setReportPending] = useState<'save' | 'send' | undefined>(undefined)
  const importInput = useRef<HTMLInputElement | null>(null)

  // 表单初值只在第一次拿到配置时填一次，之后用户的编辑不被轮询覆盖
  useEffect(() => {
    if (!appConfig.data) return
    setReportForm((prev) => prev ?? {
      DAILY_REPORT_ENABLED: appConfig.data?.['DAILY_REPORT_ENABLED'] ?? '0',
      DAILY_REPORT_TIME: appConfig.data?.['DAILY_REPORT_TIME'] ?? '21:30',
      DELIVERY_COOLDOWN_MINUTES: appConfig.data?.['DELIVERY_COOLDOWN_MINUTES'] ?? '30',
      AUTO_DELIVERY_ENABLED: appConfig.data?.['AUTO_DELIVERY_ENABLED'] ?? '0',
      AUTO_DELIVERY_TIME: appConfig.data?.['AUTO_DELIVERY_TIME'] ?? '09:30',
      AUTO_DELIVERY_PLATFORMS: appConfig.data?.['AUTO_DELIVERY_PLATFORMS'] ?? 'boss',
    })
  }, [appConfig.data])

  /** 敏感键：导出时可选是否打码。 */
  function isSecretKey(key: string): boolean {
    return /(API_KEY|HOOK_URL|TOKEN|SECRET)/i.test(key)
  }

  /** 导出全部配置为 JSON，方便换机 / 备份。 */
  function exportConfig(): void {
    if (!appConfig.data) return
    const config: Record<string, string> = {}
    for (const [key, value] of Object.entries(appConfig.data)) {
      config[key] = isSecretKey(key) && !includeSecrets ? '' : value
    }
    const payload = {
      plugin: 'dsh-get-jobs',
      version: 1,
      exportedAt: new Date().toISOString(),
      includeSecrets,
      config,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `dsh-get-jobs-配置-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
    setBackupNotice(includeSecrets ? '已导出（含 API Key 等敏感配置，注意保管）' : '已导出（敏感配置已留空）')
  }

  /**
   * 导入配置：只覆盖文件里有的键，空值跳过。
   *
   * <p>跳过空值是有意的——用「不含敏感项」的备份文件恢复时，绝不能把已有的
   * API Key 清空，否则用户会以为导入成功、结果 AI 全挂。
   */
  async function importConfig(file: File): Promise<void> {
    if (!api) return
    setBackupNotice(undefined)
    try {
      const parsed = JSON.parse(await file.text()) as { config?: Record<string, unknown> }
      const raw = (parsed.config ?? parsed) as Record<string, unknown>
      const patch: Record<string, string> = {}
      for (const [key, value] of Object.entries(raw)) {
        if (!key || key.startsWith('_')) continue
        if (value === null || value === undefined) continue
        if (typeof value === 'object') continue
        const text = String(value)
        if (text === '') continue
        patch[key] = text
      }
      const count = Object.keys(patch).length
      if (count === 0) {
        setBackupNotice('导入失败：文件里没有可用的配置项')
        return
      }
      await api.saveAppConfig(patch)
      appConfig.reload()
      report.reload()
      setBackupNotice(`已导入 ${count} 项配置（空值已跳过，不会清掉你已有的 Key）`)
    } catch (caught) {
      setBackupNotice(`导入失败：${caught instanceof Error ? caught.message : String(caught)}`)
    }
  }

  async function saveReport(): Promise<void> {
    if (!api || !reportForm) return
    setReportPending('save')
    setBackupNotice(undefined)
    try {
      await api.saveAppConfig(reportForm)
      setBackupNotice('设置已保存，到点会自动执行')
      report.reload()
      appConfig.reload()
    } catch (caught) {
      setBackupNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setReportPending(undefined)
    }
  }

  async function sendReport(): Promise<void> {
    if (!api) return
    setReportPending('send')
    setBackupNotice(undefined)
    try {
      const raw = await api.sendDailyReport() as { message?: string; data?: { message?: string } }
      setBackupNotice(String(raw?.message ?? raw?.data?.message ?? '已发送'))
      report.reload()
    } catch (caught) {
      setBackupNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setReportPending(undefined)
    }
  }

  // --------------------------------------------------------- 自定义配置（CRUD）
  const customKeys = useMemo(
    () => Object.keys(appConfig.data ?? {}).filter((key) => !CORE_KEYS.includes(key as typeof CORE_KEYS[number])).sort(),
    [appConfig.data],
  )
  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  function customValue(key: string): string {
    return customDrafts[key] ?? appConfig.data?.[key] ?? ''
  }

  async function addCustom(): Promise<void> {
    const key = newKey.trim()
    if (!api || !key || key.includes(' ')) return
    setBusy(true)
    setError(undefined)
    try {
      await api.saveAppConfig({ [key]: newValue })
      setNewKey('')
      setNewValue('')
      appConfig.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function saveCustom(key: string): Promise<void> {
    if (!api) return
    setBusy(true)
    setError(undefined)
    try {
      await api.saveAppConfig({ [key]: customValue(key) })
      setCustomDrafts((prev) => { const next = { ...prev }; delete next[key]; return next })
      appConfig.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function deleteCustom(key: string): Promise<void> {
    if (!api) return
    setBusy(true)
    setError(undefined)
    try {
      await api.deleteAppConfig(key)
      appConfig.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------------------- 黑名单分页
  const blacklist = useResource(
    async () => (api ? api.blacklist() : undefined),
    [backend.revision, api?.baseUrl],
  )
  const [page, setPage] = useState(0)

  // 测试桩或异常响应可能不是数组，这里必须兜底，否则分页算出 NaN
  const entries = Array.isArray(blacklist.data) ? blacklist.data : []
  const pageCount = Math.max(1, Math.ceil(entries.length / BLACKLIST_PAGE_SIZE))
  // 数据reload后页码可能越界，渲染前夹紧
  const safePage = Math.min(page, pageCount - 1)
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  const pageEntries = entries.slice(safePage * BLACKLIST_PAGE_SIZE, (safePage + 1) * BLACKLIST_PAGE_SIZE)

  async function addCompany(): Promise<void> {
    const value = draft.trim()
    if (!api || !value) return
    setBusy(true)
    setError(undefined)
    try {
      await api.addBlacklist(value)
      setDraft('')
      // 新记录追加在末尾，跳到最后一页让用户看得见
      setPage(Number.MAX_SAFE_INTEGER)
      blacklist.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function removeCompany(id: number): Promise<void> {
    if (!api) return
    setBusy(true)
    setError(undefined)
    try {
      await api.removeBlacklist(id)
      blacklist.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  /** CSV export of the whole blacklist (not just the current page). */
  function exportBlacklist(): void {
    const rows = Array.isArray(blacklist.data) ? blacklist.data : []
    if (rows.length === 0) return
    const lines = ['id,类型,内容,添加时间']
    for (const entry of rows) {
      const id = String(entry['id'] ?? '')
      const type = String(entry['type'] ?? 'company')
      const value = String(entry['value'] ?? '')
      const createdAt = String(entry['createdAt'] ?? entry['created_at'] ?? '')
      lines.push([id, csvCell(type), csvCell(value), csvCell(createdAt)].join(','))
    }
    // BOM 让 Excel 直接认 UTF-8，不然公司名全是乱码
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `黑名单-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  // ============================================================ 按子 tab 渲染
  function renderSystem(): React.ReactNode {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: tokens.space(3) }}>
        <Card
          title="就绪检查"
          actions={<Badge tone={ready.data?.ready ? 'success' : 'warning'}>
            {ready.data ? (ready.data.ready ? '全部就绪' : `${ready.data.checks.filter((item) => !item.ok).length} 项待处理`) : '—'}
          </Badge>}
        >
          {ready.loading ? <Skeleton height={140} /> : ready.data ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {ready.data.checks.map((item) => (
                <div key={item.id} style={{
                  display: 'flex',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: `1px solid ${tokens.color.border}`,
                  fontSize: tokens.font.sm,
                  alignItems: 'flex-start',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, marginTop: 6, flexShrink: 0,
                    background: item.ok ? tokens.color.success : tokens.color.warning }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{item.label}</div>
                    <div style={{ color: tokens.color.textMuted, fontSize: tokens.font.xs, marginTop: 2 }}>{item.message}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="读不到就绪状态" hint="GET /api/system/ready 不可用，确认后端已启动" />
          )}
        </Card>

        <Card title="环境诊断">
          {browser.loading ? <Skeleton height={120} /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: tokens.font.sm }}>
              <span style={{ color: tokens.color.textMuted }}>后端</span>
              <span>{backend.health?.reachable ? '在线' : '不可达'}</span>
              <span style={{ color: tokens.color.textMuted }}>浏览器</span>
              <span>{browser.data?.['initialized'] === true ? `已初始化（CDP ${String(browser.data['cdpPort'] ?? '—')}）` : '未初始化'}</span>
              <span style={{ color: tokens.color.textMuted }}>Boss 页面</span>
              <span>{browser.data?.['hasBossPage'] === true ? '已创建' : '未创建'}</span>
              <span style={{ color: tokens.color.textMuted }}>托管进程</span>
              <span>{backend.health?.managed ? `是（pid ${backend.health.pid ?? '—'}）` : '否'}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
            <Icon name="alert" size={12} />
            浏览器未初始化属正常：启动一次投递后才会拉起。
          </div>
        </Card>
      </div>
    )
  }

  function renderAi(): React.ReactNode {
    const today = usage.data?.today
    const run = usage.data?.run
    const limits = usage.data?.limits
    const dailyLimit = limits?.daily ?? 0
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
        <Card
          title="AI 用量与预算"
          actions={(
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {costDirty ? <Badge tone="warning">有未保存改动</Badge> : costSaved ? <Badge tone="success">已保存 {costSaved}</Badge> : null}
              <Button icon="refresh" onClick={() => usage.reload()} disabled={usage.loading}>刷新用量</Button>
              <Button tone="primary" icon="check" onClick={saveCost} disabled={!costDirty || busy || !api}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </div>
          )}
        >
          {usage.loading ? <Skeleton height={140} /> : usage.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: tokens.space(3) }}>
                <Stat label="今日调用" value={`${today?.calls ?? 0} 次`} hint={today?.day} />
                <Stat
                  label="今日 Token"
                  value={formatNumber(today?.totalTokens)}
                  hint={`输入 ${formatNumber(today?.promptTokens)} / 输出 ${formatNumber(today?.completionTokens)}`}
                />
                <Stat label="本次运行" value={`${run?.calls ?? 0} 次`} hint={`${formatNumber(run?.totalTokens)} tokens`} />
                <Stat
                  label="今日剩余额度"
                  value={dailyLimit > 0 ? `${Math.max(0, dailyLimit - (today?.calls ?? 0))} 次` : '不限'}
                  hint={dailyLimit > 0 ? `上限 ${dailyLimit} 次` : '未设置上限'}
                />
              </div>

              <div style={{ fontSize: tokens.font.xs, color: tokens.color.textMuted }}>
                当前模型：<strong>{usage.data.model || '未配置'}</strong>
                {' · 思考模式：'}
                <strong>
                  {({ off: '关闭', auto: '自动', high: '深度' } as const)[usage.data.limits.thinkingMode ?? 'off']}
                </strong>
                {usage.data.thinkingSwitchSupported === false ? '（该接口不支持关闭思考，已自动跳过）' : ''}
                {limits?.maxTokens ? ` · 单次输出上限 ${limits.maxTokens} tokens` : ''}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                <Field label="单次运行调用上限" hint="一次投递最多调几次，0 = 不限">
                  <Input
                    value={costForm['AI_RUN_LIMIT'] ?? ''}
                    placeholder="30"
                    onChange={(event) => { setCostForm((prev) => ({ ...prev, AI_RUN_LIMIT: event.target.value })); setCostSaved(undefined) }}
                  />
                </Field>
                <Field label="每日调用上限" hint="按自然日累计，0 = 不限">
                  <Input
                    value={costForm['AI_DAILY_LIMIT'] ?? ''}
                    placeholder="300"
                    onChange={(event) => { setCostForm((prev) => ({ ...prev, AI_DAILY_LIMIT: event.target.value })); setCostSaved(undefined) }}
                  />
                </Field>
                <Field label="单次输出 max_tokens" hint="越小越省，招呼语 200-300 足够">
                  <Input
                    value={costForm['AI_MAX_TOKENS'] ?? ''}
                    placeholder="300"
                    onChange={(event) => { setCostForm((prev) => ({ ...prev, AI_MAX_TOKENS: event.target.value })); setCostSaved(undefined) }}
                  />
                </Field>
                <Field label="每批生成条数" hint="一次生成多条轮换，越大调用越少">
                  <Input
                    value={costForm['AI_GREETING_BATCH'] ?? ''}
                    placeholder="10"
                    onChange={(event) => { setCostForm((prev) => ({ ...prev, AI_GREETING_BATCH: event.target.value })); setCostSaved(undefined) }}
                  />
                </Field>
              </div>

              <Field label="思考模式" hint="关闭最省钱；自动跟随模型默认；深度会让模型多思考，输出 token 与费用明显增加">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {THINKING_MODES.map((mode) => {
                    const active = (costForm['AI_THINKING_MODE'] ?? 'off') === mode.value
                    return (
                      <Button
                        key={mode.value}
                        tone={active ? 'primary' : 'ghost'}
                        title={mode.hint}
                        onClick={() => {
                          setCostForm((prev) => ({ ...prev, AI_THINKING_MODE: mode.value }))
                          setCostSaved(undefined)
                        }}
                      >
                        {mode.label}
                      </Button>
                    )
                  })}
                  <span style={{ alignSelf: 'center', fontSize: tokens.font.xs, color: tokens.color.textMuted }}>
                    {THINKING_MODES.find((mode) => mode.value === (costForm['AI_THINKING_MODE'] ?? 'off'))?.hint}
                  </span>
                </div>
              </Field>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.font.sm }}>
                <Toggle
                  checked={(costForm['AI_GREETING_POOL'] ?? AI_POOL_DEFAULT) === '1'}
                  label="批量生成招呼语"
                  onChange={(next) => {
                    setCostForm((prev) => ({ ...prev, AI_GREETING_POOL: next ? '1' : '0' }))
                    setCostSaved(undefined)
                  }}
                />
                <span style={{ fontWeight: 600 }}>批量生成招呼语</span>
                <span style={{ color: tokens.color.textMuted }}>
                  开启后一批岗位共用一组招呼语，调用次数从「每岗一次」降到「每批一次」；关闭则每岗单独生成（更个性化，也更费钱）
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.font.sm }}>
                <Toggle
                  checked={(costForm['AI_SKIP_MISMATCH'] ?? '0') === '1'}
                  label="AI 岗位匹配过滤"
                  onChange={(next) => {
                    setCostForm((prev) => ({ ...prev, AI_SKIP_MISMATCH: next ? '1' : '0' }))
                    setCostSaved(undefined)
                  }}
                />
                <span style={{ fontWeight: 600 }}>AI 岗位匹配过滤</span>
                <span style={{ color: tokens.color.textMuted }}>
                  开启后每个岗位先花一次很小的调用问模型「匹配吗」，不匹配就不投；调用次数会随投递数增加，按需开启
                </span>
              </div>
            </div>
          ) : (
            <Empty
              title="读不到 AI 用量"
              hint="确认后端已启动（GET /api/ai/usage）"
              action={<Button onClick={usage.reload}>重试</Button>}
            />
          )}
        </Card>

        <Card
          title="接口与推送"
          actions={(
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {connDirty ? <Badge tone="warning">有未保存改动</Badge> : connSaved ? <Badge tone="success">已保存 {connSaved}</Badge> : null}
              <Button tone="primary" icon="check" onClick={saveConn} disabled={!connDirty || busy || !api}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </div>
          )}
        >
          {appConfig.loading ? <Skeleton height={220} /> : appConfig.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
              <div>
                <div style={{ fontSize: tokens.font.sm, fontWeight: 600, marginBottom: 8, color: tokens.color.textMuted }}>大模型接口</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Field label="接口地址（BASE_URL）" hint="兼容 OpenAI 协议的地址，如 https://api.deepseek.com">
                    <Input
                      value={connForm['BASE_URL'] ?? ''}
                      placeholder="https://api.deepseek.com"
                      onChange={(event) => { setConnForm((prev) => ({ ...prev, BASE_URL: event.target.value })); setConnSaved(undefined) }}
                    />
                  </Field>
                  <Field label="密钥（API_KEY）" hint="保存在本机 SQLite，只用于生成打招呼文案">
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Input
                        type={showKey ? 'text' : 'password'}
                        value={connForm['API_KEY'] ?? ''}
                        placeholder="sk-…"
                        onChange={(event) => { setConnForm((prev) => ({ ...prev, API_KEY: event.target.value })); setConnSaved(undefined) }}
                      />
                      <Button onClick={() => setShowKey((value) => !value)}>{showKey ? '隐藏' : '显示'}</Button>
                    </div>
                  </Field>
                  <Field label="模型（MODEL）" hint="推荐 deepseek-flash：便宜、够快，配合下面的预算闸门足够用">
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Input
                        value={connForm['MODEL'] ?? ''}
                        placeholder="deepseek-flash"
                        onChange={(event) => { setConnForm((prev) => ({ ...prev, MODEL: event.target.value })); setConnSaved(undefined) }}
                      />
                      <Button
                        onClick={() => { setConnForm((prev) => ({ ...prev, MODEL: 'deepseek-flash' })); setConnSaved(undefined) }}
                        title="填入推荐模型"
                      >
                        用推荐
                      </Button>
                    </div>
                  </Field>
                </div>
              </div>
              <div>
                <div style={{ fontSize: tokens.font.sm, fontWeight: 600, marginBottom: 8, color: tokens.color.textMuted }}>企业微信推送</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Field label="机器人 Webhook（HOOK_URL）" hint="群机器人设置里复制，形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…">
                    <Input
                      value={connForm['HOOK_URL'] ?? ''}
                      placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"
                      onChange={(event) => { setConnForm((prev) => ({ ...prev, HOOK_URL: event.target.value })); setConnSaved(undefined) }}
                    />
                  </Field>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.font.sm }}>
                    <Toggle
                      checked={(connForm['BOT_IS_SEND'] ?? '') === '1'}
                      label="启用推送"
                      onChange={(next) => { setConnForm((prev) => ({ ...prev, BOT_IS_SEND: next ? '1' : '0' })); setConnSaved(undefined) }}
                    />
                    <span style={{ color: tokens.color.textMuted }}>投递结果推送到企业微信群</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <Empty title="读不到配置" hint="确认后端已启动（GET /api/config）" action={<Button onClick={appConfig.reload}>重试</Button>} />
          )}
        </Card>

        <Card
          title="AI 打招呼文案"
          actions={(
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {aiDirty ? <Badge tone="warning">有未保存改动</Badge> : aiSaved ? <Badge tone="success">已保存 {aiSaved}</Badge> : null}
              <Button tone="primary" icon="check" onClick={saveAi} disabled={!aiDirty || busy || !api}>
                {busy ? '保存中…' : '保存'}
              </Button>
            </div>
          )}
        >
          <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted, marginBottom: 10 }}>
            这两段就是 Boss 的 AI 打招呼依据：<code>introduce</code> 提供背景，<code>prompt</code> 决定怎么开口。
            也可以在「简历」页解析后一键生成。
          </div>
          {profile.loading ? <Skeleton height={160} /> : profile.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
              <Field label="固定开头（GREETING_PREFIX）" hint="每次首次沟通都会拼在正文最前面；留空则不拼。改完点右边的保存">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Input
                    value={prefixForm ?? ''}
                    placeholder="您好，能否看一下我的简历，这是我的作品集 https://…"
                    onChange={(event) => { setPrefixForm(event.target.value); setPrefixNotice(undefined) }}
                  />
                  <Button onClick={savePrefix} disabled={!api || busy}>保存开头</Button>
                  {prefixNotice ? (
                    <span style={{ fontSize: tokens.font.xs, color: tokens.color.textMuted, whiteSpace: 'nowrap' }}>{prefixNotice}</span>
                  ) : null}
                </div>
              </Field>
              <Field label="自我介绍（introduce）" hint="你的技术栈、项目成果；带上数字（并发量 / QPS / 数据量）效果最好，100-200 字">
                <Textarea
                  value={aiForm.introduce}
                  rows={5}
                  onChange={(event) => setAiForm((prev) => ({ ...prev, introduce: event.target.value }))}
                />
              </Field>
              <Field label="打招呼提示词（prompt）" hint="决定怎么写、写多长；写死字数的提示词会一直生成很短的招呼语">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Textarea
                    value={aiForm.prompt}
                    rows={7}
                    onChange={(event) => setAiForm((prev) => ({ ...prev, prompt: event.target.value }))}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Button
                      onClick={() => setAiForm((prev) => ({ ...prev, prompt: RECOMMENDED_GREETING_PROMPT }))}
                    >
                      用推荐提示词
                    </Button>
                    <span style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
                      推荐版要求 80-120 字：技术栈 → 真实成果（带数字）→ 求职意向
                    </span>
                  </div>
                </div>
              </Field>
            </div>
          ) : (
            <Empty title="读不到 AI 配置" hint="确认后端已启动（GET /api/ai/config）" action={<Button onClick={profile.reload}>重试</Button>} />
          )}
        </Card>
      </div>
    )
  }

  function renderBlacklist(): React.ReactNode {
    return (
      <Card
        title="黑名单"
        actions={(
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge tone="neutral">{entries.length} 条</Badge>
            <Button icon="export" onClick={exportBlacklist} disabled={entries.length === 0}>导出 CSV</Button>
          </div>
        )}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: tokens.space(3) }}>
          <Input
            value={draft}
            placeholder="公司名称"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void addCompany() }}
          />
          <Button tone="primary" icon="check" onClick={addCompany} disabled={busy || !draft.trim()}>加入</Button>
        </div>

        {blacklist.loading ? <Skeleton height={100} /> : entries.length === 0 ? (
          <Empty title="黑名单为空" hint="投递结束后，回复「不合适」的公司会自动加入" />
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {pageEntries.map((entry) => {
                const id = Number(entry['id'] ?? 0)
                return (
                  <div key={id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 0',
                    borderBottom: `1px solid ${tokens.color.border}`,
                    fontSize: tokens.font.sm,
                  }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {String(entry['value'] ?? '')}
                    </span>
                    <span style={{ color: tokens.color.textFaint }}>{String(entry['type'] ?? 'company')}</span>
                    <Button tone="ghost" onClick={() => void removeCompany(id)} disabled={busy}>移除</Button>
                  </div>
                )
              })}
            </div>
            {pageCount > 1 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: tokens.space(3), fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
                <Button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>上一页</Button>
                <span>第 {safePage + 1} / {pageCount} 页</span>
                <Button disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>下一页</Button>
                <Spacer />
                <span>共 {entries.length} 条，每页 {BLACKLIST_PAGE_SIZE} 条</span>
              </div>
            ) : null}
          </>
        )}
      </Card>
    )
  }

  function renderCustom(): React.ReactNode {
    return (
      <Card title="自定义配置">
        <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted, marginBottom: 10 }}>
          核心键之外的配置项，可自行增删改；投递链路不依赖它们。
        </div>
        {customKeys.length === 0 ? (
          <Empty title="暂无自定义配置" hint="需要额外的键值对时在这里添加" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {customKeys.map((key) => {
              const dirty = customValue(key) !== (appConfig.data?.[key] ?? '')
              return (
                <div key={key} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 0',
                  borderBottom: `1px solid ${tokens.color.border}`,
                  fontSize: tokens.font.sm,
                }}>
                  <span style={{ width: 150, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, Consolas, monospace' }}>{key}</span>
                  <Input
                    value={customValue(key)}
                    onChange={(event) => setCustomDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                  />
                  <Button tone="primary" icon="check" disabled={!dirty || busy} onClick={() => void saveCustom(key)}>保存</Button>
                  <Button tone="danger" disabled={busy} onClick={() => void deleteCustom(key)}>删除</Button>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: tokens.space(3) }}>
          <Input
            value={newKey}
            placeholder="配置键，如 TIMEOUT_MS"
            style={{ flex: '0 0 200px' }}
            onChange={(event) => setNewKey(event.target.value)}
          />
          <Input
            value={newValue}
            placeholder="值"
            onChange={(event) => setNewValue(event.target.value)}
          />
          <Button tone="primary" icon="check" onClick={addCustom} disabled={busy || !newKey.trim() || newKey.includes(' ')}>添加</Button>
        </div>
      </Card>
    )
  }

  // 子 tab 内容容器：单独滚动，避免某 tab 内容多时整页崩
  const tabContentStyle: React.CSSProperties = {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.space(3),
  }

  function renderBackup(): React.ReactNode {
    const info = report.data
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
        <Card title="配置备份与迁移">
          <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
            导出一个 JSON 文件，里面是投递条件、AI 设置、每日目标等全部配置项；换电脑或重装时导入即可恢复。
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.font.sm }}>
            <Toggle checked={includeSecrets} label="导出时包含 API Key / webhook" onChange={setIncludeSecrets} />
            <span style={{ color: tokens.color.textMuted }}>默认不含敏感项；含 Key 的文件请自己保管好</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button icon="export" onClick={exportConfig} disabled={!api || !appConfig.data}>导出配置</Button>
            <Button icon="upload" onClick={() => importInput.current?.click()} disabled={!api}>导入配置</Button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void importConfig(file)
              }}
            />
          </div>
          {backupNotice ? (
            <div style={{ fontSize: tokens.font.xs, color: tokens.color.textMuted }}>{backupNotice}</div>
          ) : null}
        </Card>

        <Card
          title="每日汇报"
          actions={<Badge tone={info?.enabled ? 'success' : 'neutral'}>{info?.enabled ? `每天 ${info.time}` : '未开启'}</Badge>}
        >
          <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
            到点把「今天投了多少、AI 花了多少」推送到企业微信。和企业微信投递通知是两个独立开关。
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.font.sm }}>
            <Toggle
              checked={(reportForm?.['DAILY_REPORT_ENABLED'] ?? '0') === '1'}
              label="开启每日汇报"
              onChange={(next) => setReportForm((prev) => ({ ...(prev ?? {}), DAILY_REPORT_ENABLED: next ? '1' : '0' }))}
            />
            <span style={{ color: tokens.color.textMuted }}>需要先在「AI 设置 → 接口与推送」里填企业微信 webhook</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="推送时间" hint="24 小时制，如 21:30">
              <Input
                value={reportForm?.['DAILY_REPORT_TIME'] ?? ''}
                placeholder="21:30"
                onChange={(event) => setReportForm((prev) => ({ ...(prev ?? {}), DAILY_REPORT_TIME: event.target.value }))}
              />
            </Field>
            <Field label="触发安全校验后冷却" hint="分钟；填 0 = 不冷却">
              <Input
                value={reportForm?.['DELIVERY_COOLDOWN_MINUTES'] ?? ''}
                placeholder="30"
                inputMode="numeric"
                onChange={(event) => setReportForm((prev) => ({ ...(prev ?? {}), DELIVERY_COOLDOWN_MINUTES: event.target.value }))}
              />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: tokens.font.xs, color: tokens.color.textMuted }}>
            <span>上次推送：<strong>{info?.lastLabel ?? '—'}</strong></span>
            <span>webhook：<strong>{info?.hookConfigured ? '已配置' : '未配置'}</strong></span>
          </div>

          <Field label="汇报预览" hint="实际推送的内容，数字来自今天的投递与 AI 用量">
            <Textarea readOnly value={info?.preview ?? '（后端未启动，暂时取不到）'} rows={5} />
          </Field>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button tone="primary" onClick={saveReport} disabled={!api || !reportForm || reportPending !== undefined}>
              {reportPending === 'save' ? '保存中…' : '保存设置'}
            </Button>
            <Button icon="check" onClick={sendReport} disabled={!api || reportPending !== undefined}>
              {reportPending === 'send' ? '推送中…' : '立即推送一次'}
            </Button>
          </div>
        </Card>

        <Card
          title="定时投递"
          actions={
            <Badge tone={(reportForm?.['AUTO_DELIVERY_ENABLED'] ?? '0') === '1' ? 'success' : 'neutral'}>
              {(reportForm?.['AUTO_DELIVERY_ENABLED'] ?? '0') === '1'
                ? `每天 ${reportForm?.['AUTO_DELIVERY_TIME'] ?? '09:30'}`
                : '未开启'}
            </Badge>
          }
        >
          <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
            每天到点自动按顺序跑指定平台。今日目标、风控冷却、允许时段照常生效，投满会自动收工；
            同一天只触发一次，后端重启后会补跑当天还没跑过的任务。
          </div>

          <Toggle
            checked={(reportForm?.['AUTO_DELIVERY_ENABLED'] ?? '0') === '1'}
            label="开启定时投递"
            onChange={(next) => setReportForm((prev) => ({ ...(prev ?? {}), AUTO_DELIVERY_ENABLED: next ? '1' : '0' }))}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="开始时间" hint="24 小时制，如 09:30">
              <Input
                value={reportForm?.['AUTO_DELIVERY_TIME'] ?? ''}
                placeholder="09:30"
                onChange={(event) => setReportForm((prev) => ({ ...(prev ?? {}), AUTO_DELIVERY_TIME: event.target.value }))}
              />
            </Field>
            <Field label="平台顺序" hint="逗号分隔：boss,liepin,51job,zhilian">
              <Input
                value={reportForm?.['AUTO_DELIVERY_PLATFORMS'] ?? ''}
                placeholder="boss"
                onChange={(event) => setReportForm((prev) => ({ ...(prev ?? {}), AUTO_DELIVERY_PLATFORMS: event.target.value }))}
              />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button tone="primary" onClick={saveReport} disabled={!api || !reportForm || reportPending !== undefined}>
              {reportPending === 'save' ? '保存中…' : '保存定时设置'}
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: tokens.font.xl, fontWeight: 600 }}>设置</h2>
        <Spacer />
        <Button icon="refresh" onClick={() => { appConfig.reload(); blacklist.reload(); browser.reload(); ready.reload(); profile.reload() }}>刷新</Button>
      </div>

      <Tabs items={TAB_ITEMS} value={activeTab} onChange={setActiveTab} />

      {error ? <ErrorState message={error} /> : null}

      <div style={tabContentStyle}>
        {activeTab === 'system' ? renderSystem() : null}
        {activeTab === 'ai' ? renderAi() : null}
        {activeTab === 'blacklist' ? renderBlacklist() : null}
        {activeTab === 'custom' ? renderCustom() : null}
        {activeTab === 'backup' ? renderBackup() : null}
      </div>
    </div>
  )
}