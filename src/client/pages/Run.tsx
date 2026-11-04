/**
 * Run page: start/stop one platform and watch the SSE progress stream.
 * @module dsh-get-jobs/client/pages/run
 */
import React, { useEffect, useRef, useState } from 'react'

import { PLATFORMS, type Platform } from '../api.js'
import { Badge, Button, Card, Empty, ErrorState, Icon, Spacer, Tabs } from '../components.js'
import { useBackend, usePolling, useResource } from '../hooks.js'
import { pageStyle, tokens } from '../theme.js'

interface LogLine {
  id: number
  time: string
  text: string
  tone: 'info' | 'error'
}

const MAX_LINES = 300

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
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(undefined)
    }
  }

  const running = status.data?.isRunning === true
  const loggedIn = status.data?.isLoggedIn === true || login.data?.isLoggedIn === true

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
