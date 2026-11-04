/**
 * Overview: backend state, today's numbers, and the four platform rows.
 * @module dsh-get-jobs/client/pages/overview
 */
import React from 'react'

import { PLATFORMS, type Platform } from '../api.js'
import { Badge, BarList, Button, Card, Empty, ErrorState, Icon, KeyValue, Skeleton, Spacer } from '../components.js'
import { useBackend, useResource } from '../hooks.js'
import { pageStyle, tokens } from '../theme.js'

/** Platform state row: running flag plus login flag. */
function PlatformRow({
  platform,
  label,
  maintained,
  status,
}: {
  platform: Platform
  label: string
  maintained: boolean
  status?: { isRunning?: boolean; isLoggedIn?: boolean }
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 0',
      borderBottom: `1px solid ${tokens.color.border}`,
    }}>
      <span style={{ width: 84, fontSize: tokens.font.sm, fontWeight: 500 }}>{label}</span>
      <Badge tone={status?.isRunning ? 'accent' : 'neutral'}>{status?.isRunning ? '投递中' : '空闲'}</Badge>
      <Badge tone={status?.isLoggedIn ? 'success' : 'warning'}>{status?.isLoggedIn ? '已登录' : '未登录'}</Badge>
      {maintained ? null : <span style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>已停止维护</span>}
      <Spacer />
      <span style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>{platform}</span>
    </div>
  )
}

/** Landing page. */
export function Overview({ onNavigate }: { onNavigate: (page: string) => void }): React.ReactElement {
  const backend = useBackend()
  const api = backend.api

  const statuses = useResource(
    async () => {
      if (!api) return undefined
      const entries = await Promise.all(PLATFORMS.map(async (item) => {
        try {
          return [item.id, await api.status(item.id)] as const
        } catch {
          return [item.id, undefined] as const
        }
      }))
      return Object.fromEntries(entries) as Record<Platform, { isRunning?: boolean; isLoggedIn?: boolean } | undefined>
    },
    [backend.revision, api?.baseUrl],
  )

  const stats = useResource(
    async () => (api ? api.stats('boss') : undefined),
    [backend.revision, api?.baseUrl],
  )

  // 今日投递进度：和运行页共用同一份配额数据
  const quota = useResource(
    async () => (api ? api.deliveryQuota() : undefined),
    [backend.revision, api?.baseUrl],
  )

  const deliveredToday = quota.data?.delivered ?? 0
  const dailyTarget = quota.data?.target ?? 0
  const quotaPercent = dailyTarget > 0 ? Math.min(Math.round((deliveredToday / dailyTarget) * 100), 100) : 0

  const kpi = stats.data?.kpi ?? {}
  const kpiCards: Array<[string, number, string]> = [
    ['抓取岗位', Number(kpi['total'] ?? 0), '从招聘网站抓到的岗位'],
    ['已投递', Number(kpi['delivered'] ?? 0), '成功打招呼的数量'],
    ['待投递', Number(kpi['pending'] ?? 0), '尚未处理'],
    ['已过滤', Number(kpi['filtered'] ?? 0), '命中过滤规则'],
  ]

  const byStatus = (stats.data?.charts?.['byStatus'] ?? []).slice(0, 5).map((item) => ({
    label: String(item.name ?? item.label ?? '未知'),
    value: Number(item.value ?? 0),
  }))

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: tokens.font.xl, fontWeight: 600 }}>概览</h2>
        <Badge tone={backend.health?.reachable ? 'success' : 'warning'}>
          {backend.health ? (backend.health.reachable ? '后端在线' : '后端未启动') : '检查中'}
        </Badge>
        <Spacer />
        <Button icon="refresh" onClick={() => { backend.reload(); statuses.reload(); stats.reload(); quota.reload() }}>刷新</Button>
      </div>

      {backend.error ? <ErrorState message={backend.error} onRetry={backend.reload} /> : null}

      <Card
        title="后端"
        actions={(
          <>
            <Button
              tone="primary"
              icon="play"
              onClick={async () => {
                if (!api) return
                try {
                  await api.run('boss', 'start')
                } catch {
                  // Failures surface through the platform rows and toast in Run.
                }
                backend.reload()
              }}
            >启动</Button>
            <Button icon="list" onClick={() => onNavigate('run')}>查看运行</Button>
          </>
        )}
      >
        {backend.loading && !backend.health ? <Skeleton height={64} /> : (
          <KeyValue items={[
            ['地址', backend.health?.baseUrl ?? '—'],
            ['状态', backend.health?.message ?? '—'],
            ['进程', backend.health?.managed ? `插件托管（pid ${backend.health.pid ?? '—'}）` : '未托管'],
          ]} />
        )}
      </Card>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '10px 14px',
        borderRadius: tokens.radius.lg,
        border: `1px solid ${tokens.color.border}`,
        background: tokens.color.surface,
        fontSize: tokens.font.sm,
      }}>
        <span style={{ color: tokens.color.textMuted }}>今日已投</span>
        <span style={{ fontWeight: 600, fontSize: tokens.font.lg }}>{deliveredToday}</span>
        <span style={{ color: tokens.color.textMuted }}>
          {dailyTarget > 0 ? `/ ${dailyTarget} 份` : '份（未设每日目标）'}
        </span>
        {dailyTarget > 0 ? (
          <div style={{ flex: '1 1 120px', minWidth: 80, height: 6, borderRadius: 3, background: tokens.color.surfaceAlt, overflow: 'hidden' }}>
            <div style={{ width: `${quotaPercent}%`, height: '100%', background: quota.data?.reached ? tokens.color.success : tokens.color.accent }} />
          </div>
        ) : null}
        <Badge tone={quota.data?.reached ? 'success' : 'neutral'}>
          {quota.data?.reached ? '已达目标，自动停投' : dailyTarget > 0 ? `还差 ${Math.max(dailyTarget - deliveredToday, 0)} 份` : '不限额'}
        </Badge>
        <Spacer />
        <Button icon="sliders" onClick={() => onNavigate('run')}>设置今日目标</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: tokens.space(3) }}>
        {kpiCards.map(([label, value, hint]) => (
          <div key={label} style={{
            padding: '12px 14px',
            borderRadius: tokens.radius.lg,
            border: `1px solid ${tokens.color.border}`,
            background: tokens.color.bg,
            boxShadow: tokens.shadow,
          }}>
            <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>{stats.loading ? '—' : value}</div>
            <div style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>{hint}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)', gap: tokens.space(3) }}>
        <Card title="平台状态" actions={<Button icon="sliders" onClick={() => onNavigate('platforms')}>去配置</Button>}>
          {statuses.loading ? <Skeleton height={120} /> : (
            statuses.data
              ? PLATFORMS.map((item) => (
                <PlatformRow
                  key={item.id}
                  platform={item.id}
                  label={item.label}
                  maintained={item.maintained}
                  status={statuses.data?.[item.id]}
                />
              ))
              : <Empty title="暂时拿不到平台状态" hint="确认后端已启动后重试" action={<Button onClick={statuses.reload}>重试</Button>} />
          )}
        </Card>

        <Card title="投递状态分布" actions={<Button icon="list" onClick={() => onNavigate('data')}>看数据</Button>}>
          {stats.loading ? <Skeleton height={120} /> : byStatus.length > 0
            ? <BarList items={byStatus} />
            : <Empty title="还没有投递数据" hint="启动一次投递后这里会出现分布" />}
        </Card>
      </div>

      <Card title="常用动作">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button icon="sliders" onClick={() => onNavigate('platforms')}>修改投递条件</Button>
          <Button icon="upload" onClick={() => onNavigate('resume')}>导入简历生成配置</Button>
          <Button icon="export" onClick={() => onNavigate('data')}>导出岗位数据</Button>
          <Button icon="list" onClick={() => onNavigate('settings')}>黑名单与诊断</Button>
        </div>
      </Card>
    </div>
  )
}
