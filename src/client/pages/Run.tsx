/**
 * Run page: start/stop one platform and watch the SSE progress stream.
 * @module dsh-get-jobs/client/pages/run
 */
import React, { useEffect, useRef, useState } from 'react'

import { PLATFORMS, type Platform } from '../api.js'
import { Badge, Button, Card, Empty, ErrorState, Field, Icon, Input, Spacer, Tabs } from '../components.js'
import { useBackend, usePolling, useResource } from '../hooks.js'
import { pageStyle, tokens } from '../theme.js'

interface LogLine {
  id: number
  time: string
  text: string
  tone: 'info' | 'error'
}

const MAX_LINES = 300

/** 各平台每日目标对应的配置键（后端 DeliveryQuotaService 用同一套名字）。 */
const PLATFORM_QUOTA_KEYS: Record<Platform, string> = {
  boss: 'DELIVERY_DAILY_TARGET_BOSS',
  liepin: 'DELIVERY_DAILY_TARGET_LIEPIN',
  '51job': 'DELIVERY_DAILY_TARGET_51JOB',
  zhilian: 'DELIVERY_DAILY_TARGET_ZHILIAN',
}

/** Delivery console. */
export function Run(): React.ReactElement {
  const backend = useBackend()
  const api = backend.api
  const [platform, setPlatform] = useState<Platform>('boss')
  const [lines, setLines] = useState<LogLine[]>([])
  const [pending, setPending] = useState<'start' | 'stop' | undefined>(undefined)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [loginPending, setLoginPending] = useState(false)
  const [loginNotice, setLoginNotice] = useState<string | undefined>(undefined)
  const [watching, setWatching] = useState(false)
  const watchTicks = useRef(0)
  const counter = useRef(0)

  const status = useResource(
    async () => (api ? api.status(platform) : undefined),
    [backend.revision, api?.baseUrl, platform],
  )

  const login = useResource(
    async () => (api ? api.loginState(platform) : undefined),
    [backend.revision, api?.baseUrl, platform],
  )

  // 今日投递进度 + 每日目标（合计 / 单平台两级）
  const quota = useResource(
    async () => (api ? api.deliveryQuota() : undefined),
    [backend.revision, api?.baseUrl],
  )

  const [quotaForm, setQuotaForm] = useState<Record<string, string> | undefined>(undefined)
  const [quotaNotice, setQuotaNotice] = useState<string | undefined>(undefined)
  const [quotaPending, setQuotaPending] = useState<'save' | 'reset' | 'cooldown' | undefined>(undefined)

  // 表单初值来自后端配置；只加载一次，用户改过之后不再被轮询覆盖
  useEffect(() => {
    if (!api) return
    let alive = true
    api.appConfig()
      .then((config) => {
        if (!alive) return
        setQuotaForm({
          DELIVERY_DAILY_TARGET: config['DELIVERY_DAILY_TARGET'] ?? '0',
          DELIVERY_DAILY_TARGET_BOSS: config['DELIVERY_DAILY_TARGET_BOSS'] ?? '0',
          DELIVERY_DAILY_TARGET_LIEPIN: config['DELIVERY_DAILY_TARGET_LIEPIN'] ?? '0',
          DELIVERY_DAILY_TARGET_51JOB: config['DELIVERY_DAILY_TARGET_51JOB'] ?? '0',
          DELIVERY_DAILY_TARGET_ZHILIAN: config['DELIVERY_DAILY_TARGET_ZHILIAN'] ?? '0',
          DELIVERY_WORK_HOURS: config['DELIVERY_WORK_HOURS'] ?? '',
          DELIVERY_COMPANY_COOLDOWN_DAYS: config['DELIVERY_COMPANY_COOLDOWN_DAYS'] ?? '0',
        })
      })
      .catch(() => { if (alive) setQuotaForm({}) })
    return () => { alive = false }
  }, [backend.revision, api?.baseUrl])

  // 扫码期间每 3 秒问一次；扫完（或超时 2 分钟）就停，避免无意义轮询
  usePolling(() => {
    watchTicks.current += 1
    if (watchTicks.current > 40) {
      setWatching(false)
      return
    }
    login.reload()
    status.reload()
  }, 3000, watching)

  useEffect(() => {
    if (login.data?.isLoggedIn && watching) {
      setWatching(false)
      setLoginNotice('登录成功')
    }
  }, [login.data?.isLoggedIn, watching])

  // Re-subscribe whenever the platform changes; EventSource reconnects on its own.
  useEffect(() => {
    if (!api) return
    setLines([])
    const source = new EventSource(`${api.baseUrl}/api/${platform}/stream`)
    const push = (text: string, tone: 'info' | 'error' = 'info'): void => {
      setLines((previous) => {
        const next = [...previous, { id: counter.current++, time: new Date().toLocaleTimeString('zh-CN'), text, tone }]
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
      })
    }
    source.addEventListener('connected', () => push('已连接进度推送'))
    source.addEventListener('ping', () => undefined)
    source.addEventListener('progress', (event) => {
      const raw = (event as MessageEvent).data as string
      try {
        const payload = JSON.parse(raw) as Record<string, unknown>
        const message = String(payload['message'] ?? raw)
        const level = String(payload['level'] ?? 'info')
        push(message, level === 'error' ? 'error' : 'info')
      } catch {
        push(raw)
      }
    })
    source.onerror = () => push('进度连接中断，正在重连…', 'error')
    return () => source.close()
  }, [backend.revision, api?.baseUrl, platform])

  /**
   * 拉起后端浏览器并切到登录页二维码。
   *
   * 后端是异步的（首次要先把整个浏览器拉起来，约 30 秒），这里只负责提示 + 开始轮询。
   */
  async function openLogin(): Promise<void> {
    if (!api) return
    setLoginPending(true)
    setActionError(undefined)
    setLoginNotice(undefined)
    try {
      const result = await api.triggerLogin(platform)
      setLoginNotice(result.message)
      watchTicks.current = 0
      setWatching(true)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoginPending(false)
    }
  }

  async function act(action: 'start' | 'stop'): Promise<void> {
    if (!api) return
    setPending(action)
    setActionError(undefined)
    try {
      const result = await api.run(platform, action)
      if (result['success'] === false) {
        setActionError(String(result['message'] ?? '操作未成功'))
      }
      status.reload()
      // 投递结束 / 开始时今日计数都可能变化，顺手刷新进度
      quota.reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(undefined)
    }
  }

  async function saveQuota(): Promise<void> {
    if (!api || !quotaForm) return
    setQuotaPending('save')
    setQuotaNotice(undefined)
    try {
      await api.saveAppConfig(quotaForm)
      setQuotaNotice('已保存，下次启动投递时按新目标执行')
      quota.reload()
    } catch (caught) {
      setQuotaNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setQuotaPending(undefined)
    }
  }

  async function clearCooldown(): Promise<void> {
    if (!api) return
    setQuotaPending('cooldown')
    setQuotaNotice(undefined)
    try {
      await api.clearCooldown()
      setQuotaNotice('已解除风控冷却')
      quota.reload()
    } catch (caught) {
      setQuotaNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setQuotaPending(undefined)
    }
  }

  async function resetQuota(): Promise<void> {
    if (!api) return
    setQuotaPending('reset')
    setQuotaNotice(undefined)
    try {
      await api.resetDeliveryQuota()
      setQuotaNotice('今日计数已清零，可以继续投递')
      quota.reload()
    } catch (caught) {
      setQuotaNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setQuotaPending(undefined)
    }
  }

  const running = status.data?.isRunning === true
  const loggedIn = status.data?.isLoggedIn === true || login.data?.isLoggedIn === true

  const quotaData = quota.data
  const deliveredToday = quotaData?.delivered ?? 0
  const dailyTarget = quotaData?.target ?? 0
  const quotaPercent = dailyTarget > 0 ? Math.min(Math.round((deliveredToday / dailyTarget) * 100), 100) : 0
  const quotaReached = quotaData?.reached === true
  const failureTotal = quotaData?.failures?.total ?? 0
  const failureReasons = quotaData?.failures?.byReason ?? []
  const cooldown = quotaData?.cooldown
  const coolingDown = cooldown?.active === true

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: tokens.font.xl, fontWeight: 600 }}>运行</h2>
        <Badge tone={running ? 'accent' : 'neutral'}>{running ? '投递中' : '空闲'}</Badge>
        <Badge tone={loggedIn ? 'success' : 'warning'}>{loggedIn ? '已登录' : '未登录'}</Badge>
        <Spacer />
        <Button icon="refresh" onClick={() => { status.reload(); login.reload() }} disabled={!api}>刷新状态</Button>
        <Button
          icon="play"
          onClick={openLogin}
          disabled={!api || running || loginPending}
          title={running ? '投递进行中不能切页面，先停止再登录' : undefined}
        >
          {loginPending ? '正在打开…' : loggedIn ? '重新登录' : '去登录（扫码）'}
        </Button>
        {running
          ? <Button tone="danger" icon="stop" onClick={() => act('stop')} disabled={pending !== undefined}>{pending === 'stop' ? '停止中…' : '停止投递'}</Button>
          : <Button tone="primary" icon="play" onClick={() => act('start')} disabled={pending !== undefined || !loggedIn}>{pending === 'start' ? '启动中…' : '开始投递'}</Button>}
      </div>

      <Tabs
        items={PLATFORMS.map((item) => ({ value: item.id, label: item.label }))}
        value={platform}
        onChange={setPlatform}
      />

      {actionError ? <ErrorState message={actionError} onRetry={() => act(running ? 'stop' : 'start')} /> : null}
      {!loggedIn && status.data ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          borderRadius: tokens.radius.md,
          border: `1px solid ${tokens.color.warning}`,
          background: tokens.color.warningSoft,
          fontSize: tokens.font.sm,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>该平台尚未登录</div>
            <div style={{ color: tokens.color.textMuted, marginTop: 2 }}>
              点右侧按钮会弹出浏览器窗口并切到二维码，用手机扫码后这里会自动变成「已登录」。
            </div>
          </div>
          <Button tone="primary" onClick={openLogin} disabled={running || loginPending}>
            {loginPending ? '正在打开…' : '去扫码登录'}
          </Button>
        </div>
      ) : null}

      {loginNotice ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: tokens.radius.md,
          border: `1px solid ${tokens.color.border}`,
          background: tokens.color.surface,
          fontSize: tokens.font.sm,
          color: tokens.color.textMuted,
        }}>
          <Badge tone={loggedIn ? 'success' : 'accent'}>{loggedIn ? '已登录' : '等待扫码'}</Badge>
          <span style={{ flex: 1, minWidth: 0 }}>{loginNotice}</span>
          {watching ? <span style={{ color: tokens.color.textFaint }}>每 3 秒检测一次…</span> : null}
        </div>
      ) : null}

      <Card
        title="今日投递目标"
        actions={(
          <>
            <Badge tone={quotaReached ? 'success' : 'accent'}>
              {quotaReached ? '已达目标，自动停投' : `今日 ${deliveredToday}${dailyTarget > 0 ? ` / ${dailyTarget}` : ''} 份`}
            </Badge>
            <Button icon="refresh" onClick={resetQuota} disabled={!api || quotaPending !== undefined}>
              {quotaPending === 'reset' ? '重置中…' : '重置今日计数'}
            </Button>
          </>
        )}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: tokens.font.sm }}>
          <span style={{ fontWeight: 600, fontSize: tokens.font.xl, lineHeight: 1.1 }}>{deliveredToday}</span>
          <span style={{ color: tokens.color.textMuted }}>
            {dailyTarget > 0 ? `/ ${dailyTarget} 份（今日合计）` : '份（今日合计，未设上限）'}
          </span>
          <Spacer />
          {dailyTarget > 0 ? (
            <span style={{ color: quotaReached ? tokens.color.success : tokens.color.textMuted }}>
              {quotaReached ? '已达成' : `还差 ${Math.max(dailyTarget - deliveredToday, 0)} 份`}
            </span>
          ) : null}
        </div>

        {dailyTarget > 0 ? (
          <div style={{ height: 6, borderRadius: 3, background: tokens.color.surfaceAlt, overflow: 'hidden' }}>
            <div style={{
              width: `${quotaPercent}%`,
              height: '100%',
              background: quotaReached ? tokens.color.success : tokens.color.accent,
              transition: 'width 200ms ease',
            }} />
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Field label="合计每日目标" hint="0 = 不限；所有平台加起来投到这么多就停">
            <Input
              value={quotaForm?.['DELIVERY_DAILY_TARGET'] ?? ''}
              placeholder="0"
              inputMode="numeric"
              onChange={(event) => { setQuotaForm((prev) => ({ ...(prev ?? {}), DELIVERY_DAILY_TARGET: event.target.value })); setQuotaNotice(undefined) }}
            />
          </Field>
          <Field label="允许投递时段" hint="如 9-23；留空 = 全天可投，跨天写 22-6">
            <Input
              value={quotaForm?.['DELIVERY_WORK_HOURS'] ?? ''}
              placeholder="9-23"
              onChange={(event) => { setQuotaForm((prev) => ({ ...(prev ?? {}), DELIVERY_WORK_HOURS: event.target.value })); setQuotaNotice(undefined) }}
            />
          </Field>
          <Field label="公司冷却（天）" hint="同一家公司 N 天内不重复投；0 = 关">
            <Input
              value={quotaForm?.['DELIVERY_COMPANY_COOLDOWN_DAYS'] ?? ''}
              placeholder="0"
              inputMode="numeric"
              onChange={(event) => { setQuotaForm((prev) => ({ ...(prev ?? {}), DELIVERY_COMPANY_COOLDOWN_DAYS: event.target.value })); setQuotaNotice(undefined) }}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {PLATFORMS.map((item) => {
            const key = PLATFORM_QUOTA_KEYS[item.id]
            const row = quotaData?.platforms?.[item.id]
            return (
              <div key={item.id} style={{ flex: '1 1 128px', minWidth: 128 }}>
                <Field label={item.label} hint={`今日 ${row?.delivered ?? 0} 份 · 0 = 不限`}>
                  <Input
                    value={quotaForm?.[key] ?? ''}
                    placeholder="0"
                    inputMode="numeric"
                    onChange={(event) => { setQuotaForm((prev) => ({ ...(prev ?? {}), [key]: event.target.value })); setQuotaNotice(undefined) }}
                  />
                </Field>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Button tone="primary" onClick={saveQuota} disabled={!api || !quotaForm || quotaPending !== undefined}>
            {quotaPending === 'save' ? '保存中…' : '保存目标'}
          </Button>
          {quotaData?.workHours ? (
            <Badge tone={quotaData.inWorkHours ? 'success' : 'warning'}>
              {quotaData.inWorkHours ? `时段内 ${quotaData.workHours}` : `不在时段 ${quotaData.workHours}`}
            </Badge>
          ) : null}
          {quotaNotice ? <span style={{ fontSize: tokens.font.xs, color: tokens.color.textMuted }}>{quotaNotice}</span> : null}
        </div>

        {failureTotal > 0 ? (
          <div style={{ fontSize: tokens.font.xs, color: tokens.color.textMuted }}>
            今日没投出去 <strong>{failureTotal}</strong> 条
            {failureReasons.length > 0 ? `（${failureReasons.slice(0, 3).map((item) => `${item.reason} ${item.count}`).join(' / ')}）` : ''}
          </div>
        ) : null}

        <div style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
          合计与单平台两级配额 <strong>任一到达</strong> 就自动停投；改完目标立刻生效，不用重启后端。
        </div>
      </Card>

      {coolingDown ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: tokens.radius.md,
          border: `1px solid ${tokens.color.warning}`,
          background: tokens.color.warningSoft,
          fontSize: tokens.font.sm,
        }}>
          <Icon name="alert" size={14} />
          <span style={{ flex: 1, minWidth: 0 }}>
            风控冷却中：还需约 {cooldown?.remainingMinutes ?? 0} 分钟
            {cooldown?.reason ? `（${cooldown.reason}）` : ''}。期间点「开始投递」会被拒绝。
          </span>
          <Button onClick={clearCooldown} disabled={quotaPending !== undefined}>
            {quotaPending === 'cooldown' ? '解除中…' : '解除冷却'}
          </Button>
        </div>
      ) : null}

      {quotaReached ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: tokens.radius.md,
          border: `1px solid ${tokens.color.success}`,
          background: tokens.color.successSoft,
          fontSize: tokens.font.sm,
        }}>
          <Icon name="check" size={14} />
          <span style={{ flex: 1, minWidth: 0 }}>
            今日投递已达目标，现在点「开始投递」会被后端直接拒绝。想继续投，先调高目标或点上面的「重置今日计数」。
          </span>
        </div>
      ) : null}

      <Card
        title="投递进度"
        actions={<Button icon="refresh" onClick={() => setLines([])} disabled={lines.length === 0}>清空</Button>}
      >
        {lines.length === 0 ? (
          <Empty title="暂无进度" hint="点击「开始投递」后，这里会实时滚动每条投递结果" />
        ) : (
          <div style={{
            maxHeight: 380,
            overflow: 'auto',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: tokens.font.sm,
            lineHeight: 1.7,
          }}>
            {lines.map((line) => (
              <div key={line.id} style={{ display: 'flex', gap: 10, color: line.tone === 'error' ? tokens.color.danger : tokens.color.text }}>
                <span style={{ color: tokens.color.textFaint, flex: '0 0 auto' }}>{line.time}</span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{line.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
        <Icon name="clock" size={12} />
        进度来自后端 SSE，断线会自动重连；关闭面板不会中断投递。
      </div>
    </div>
  )
}
