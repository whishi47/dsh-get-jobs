/**
 * Data page: filters, KPI, distribution bars, paged rows, and export.
 * @module dsh-get-jobs/client/pages/data
 */
import React, { useEffect, useMemo, useState } from 'react'

import { PLATFORMS, timeLabel, type Platform } from '../api.js'
import { Badge, BarList, Button, Card, Empty, ErrorState, Field, Icon, Input, Skeleton, Spacer, Table } from '../components.js'
import { useBackend, useResource } from '../hooks.js'
import { pageStyle, tokens } from '../theme.js'

const PAGE_SIZE = 20

/** Job table plus the export entry point. */
export function Data(): React.ReactElement {
  const backend = useBackend()
  const api = backend.api
  const [platform, setPlatform] = useState<Platform>('boss')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | undefined>(undefined)
  // 账号与数据管理：换招聘账号前先导出再清空，避免两个账号的数据混在一起
  const [accountForm, setAccountForm] = useState<string | undefined>(undefined)
  const [accountNotice, setAccountNotice] = useState<string | undefined>(undefined)
  const [pendingScope, setPendingScope] = useState<'jobs' | 'failures' | 'stats' | 'all' | undefined>(undefined)
  const [dataBusy, setDataBusy] = useState(false)

  const query = useMemo(() => {
    const base: Record<string, string | number> = { page, size: PAGE_SIZE }
    if (keyword.trim()) base['keyword'] = keyword.trim()
    if (status.trim()) base['statuses'] = status.trim()
    return base
  }, [keyword, status, page])

  const summary = useResource(
    async () => (api ? api.dataSummary() : undefined),
    [backend.revision, api?.baseUrl],
  )

  useEffect(() => {
    if (summary.data && accountForm === undefined) {
      setAccountForm(summary.data.accountLabel ?? '')
    }
  }, [summary.data, accountForm])

  const stats = useResource(
    async () => (api ? api.stats(platform, { keyword: keyword.trim(), statuses: status.trim() }) : undefined),
    [backend.revision, api?.baseUrl, platform, keyword, status],
  )

  const jobs = useResource(
    async () => (api ? api.jobs(platform, query) : undefined),
    [backend.revision, api?.baseUrl, platform, query],
  )

  const kpi = stats.data?.kpi ?? {}
  const byCity = (stats.data?.charts?.['byCity'] ?? []).slice(0, 6).map((item) => ({
    label: String(item.name ?? item.label ?? '未知'),
    value: Number(item.value ?? 0),
  }))

  const rows = (jobs.data?.items ?? []).map((item) => [
    String(item['companyName'] ?? item['comp_name'] ?? item['company'] ?? '—'),
    String(item['jobName'] ?? item['job_title'] ?? item['title'] ?? '—'),
    String(item['salary'] ?? item['job_salary_text'] ?? '—'),
    String(item['location'] ?? item['job_area'] ?? '—'),
    <Badge tone={String(item['deliveryStatus'] ?? item['delivered'] ?? '').includes('已') ? 'success' : 'neutral'}>
      {String(item['deliveryStatus'] ?? (Number(item['delivered'] ?? 0) === 1 ? '已投递' : '未投递'))}
    </Badge>,
    String(item['hrActiveStatus'] ?? item['hr_active_status'] ?? '—'),
    <span style={{ color: tokens.color.textFaint }}>{timeLabel(item['updatedAt'] ?? item['update_time'])}</span>,
  ])

  const total = jobs.data?.total ?? 0
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  async function saveAccount(): Promise<void> {
    if (!api) return
    setDataBusy(true)
    setAccountNotice(undefined)
    try {
      const raw = await api.saveAccountLabel(accountForm ?? '') as { message?: string }
      setAccountNotice(raw?.message ?? '账号标签已保存')
      summary.reload()
    } catch (caught) {
      setAccountNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setDataBusy(false)
    }
  }

  /** 导出全部业务数据为 JSON（不含 API Key 与登录态）。 */
  async function exportAll(): Promise<void> {
    if (!api) return
    setDataBusy(true)
    setAccountNotice(undefined)
    try {
      const data = await api.exportAllData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `dsh-get-jobs-数据-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(href), 1_000)
      setAccountNotice('已导出（不含 API Key 与登录态）')
    } catch (caught) {
      setAccountNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setDataBusy(false)
    }
  }

  async function clearScope(scope: 'jobs' | 'failures' | 'stats' | 'all'): Promise<void> {
    if (!api) return
    setDataBusy(true)
    setAccountNotice(undefined)
    try {
      const raw = await api.dataClear(scope) as { message?: string }
      setPendingScope(undefined)
      setAccountNotice(raw?.message ?? '已清空')
      summary.reload()
      stats.reload()
      jobs.reload()
    } catch (caught) {
      setAccountNotice(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setDataBusy(false)
    }
  }

  async function exportXlsx(target: Platform | 'all' = platform): Promise<void> {
    if (!api) return
    setExporting(true)
    setExportError(undefined)
    try {
      const url = api.exportUrl({ platform: target, keyword: keyword.trim(), statuses: status.trim() })
      const response = await fetch(url)
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text && text.length < 300 ? text : `导出失败（${response.status}）`)
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = `jobs-${target}-${new Date().toISOString().slice(0, 10)}.xlsx`
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: tokens.font.xl, fontWeight: 600 }}>数据</h2>
        <Badge tone="neutral">{total} 条</Badge>
        <Spacer />
        <Button icon="refresh" onClick={() => { stats.reload(); jobs.reload() }}>刷新</Button>
        <Button icon="export" onClick={() => void exportXlsx('all')} disabled={exporting || !api}>
          合并导出
        </Button>
        <Button tone="primary" icon="export" onClick={() => void exportXlsx()} disabled={exporting || !api}>
          {exporting ? '导出中…' : '导出 Excel'}
        </Button>
      </div>

      <Card
        title="账号与数据"
        actions={(
          <Badge tone={summary.data?.accountLabel ? 'accent' : 'neutral'}>
            {summary.data?.accountLabel ? `当前账号：${summary.data.accountLabel}` : '未标记账号'}
          </Badge>
        )}
      >
        <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
          换招聘账号前：先「导出全部数据」，再「清空岗位数据」。配置（API Key、每日目标、招呼语）与登录态不会被清掉。
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 200 }}>
            <Field label="当前账号标签" hint="只做标记，比如「Boss A / 尾号 8888」">
              <Input
                value={accountForm ?? ''}
                placeholder="账号A"
                onChange={(event) => { setAccountForm(event.target.value); setAccountNotice(undefined) }}
              />
            </Field>
          </div>
          <Button tone="primary" onClick={saveAccount} disabled={!api || dataBusy}>保存标签</Button>
          <Button icon="export" onClick={exportAll} disabled={!api || dataBusy}>导出全部数据</Button>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: tokens.font.xs, color: tokens.color.textMuted }}>
          <span>岗位 <strong>{summary.data?.jobs ?? 0}</strong></span>
          <span>已投递 <strong>{summary.data?.delivered ?? 0}</strong></span>
          <span>已过滤 <strong>{summary.data?.filtered ?? 0}</strong></span>
          <span>失败记录 <strong>{summary.data?.failures ?? 0}</strong></span>
          <span>统计天数 <strong>{summary.data?.deliveryDays ?? 0}</strong></span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {([
            ['jobs', '清空岗位数据'],
            ['failures', '清空失败记录'],
            ['stats', '清空每日统计'],
            ['all', '清空全部业务数据'],
          ] as const).map(([scope, label]) => (
            pendingScope === scope ? (
              <span key={scope} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <Button tone="danger" onClick={() => void clearScope(scope)} disabled={dataBusy}>
                  {dataBusy ? '清空中…' : `确认${label}`}
                </Button>
                <Button onClick={() => setPendingScope(undefined)} disabled={dataBusy}>取消</Button>
              </span>
            ) : (
              <Button
                key={scope}
                tone={scope === 'all' ? 'danger' : 'default'}
                onClick={() => { setPendingScope(scope); setAccountNotice(undefined) }}
                disabled={!api || dataBusy}
              >
                {label}
              </Button>
            )
          ))}
        </div>

        {accountNotice ? (
          <div style={{ fontSize: tokens.font.xs, color: tokens.color.textMuted }}>{accountNotice}</div>
        ) : null}
      </Card>

      {exportError ? <ErrorState message={exportError} onRetry={exportXlsx} /> : null}

      <Card compact>
        <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 160px max-content', gap: tokens.space(3), alignItems: 'end' }}>
          <Field label="平台">
            <select
              value={platform}
              onChange={(event) => { setPlatform(event.target.value as Platform); setPage(1) }}
              style={{
                width: '100%',
                padding: '6px 9px',
                fontSize: tokens.font.md,
                borderRadius: tokens.radius.md,
                border: `1px solid ${tokens.color.border}`,
                background: tokens.color.bg,
                color: tokens.color.text,
              }}
            >
              {PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="关键词">
            <Input
              value={keyword}
              placeholder="公司或岗位关键词"
              onChange={(event) => { setKeyword(event.target.value); setPage(1) }}
            />
          </Field>
          <Field label="投递状态">
            <Input
              value={status}
              placeholder="已投递 / 未投递"
              onChange={(event) => { setStatus(event.target.value); setPage(1) }}
            />
          </Field>
          <Button onClick={() => { setKeyword(''); setStatus(''); setPage(1) }} icon="refresh">重置</Button>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: tokens.space(3) }}>
        {[
          ['抓取', Number(kpi['total'] ?? 0)],
          ['已投递', Number(kpi['delivered'] ?? 0)],
          ['未投递', Number(kpi['pending'] ?? 0)],
          ['已过滤', Number(kpi['filtered'] ?? 0)],
        ].map(([label, value]) => (
          <div key={String(label)} style={{
            padding: '10px 12px',
            borderRadius: tokens.radius.lg,
            border: `1px solid ${tokens.color.border}`,
            background: tokens.color.bg,
          }}>
            <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{stats.loading ? '—' : value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gap: tokens.space(3) }}>
        <Card title="岗位列表" compact>
          {jobs.error ? <ErrorState message={jobs.error} onRetry={jobs.reload} /> : null}
          {jobs.loading ? <Skeleton height={240} /> : (
            <>
              <Table
                headers={['公司', '岗位', '薪资', '地点', '状态', 'HR', '更新']}
                rows={rows}
                empty={<Empty title="没有匹配的岗位" hint="换个平台或清空筛选条件" />}
                maxHeight={420}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 10, fontSize: tokens.font.sm }}>
                <span style={{ color: tokens.color.textMuted }}>第 {page} / {maxPage} 页</span>
                <Spacer />
                <Button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>上一页</Button>
                <Button onClick={() => setPage((value) => Math.min(maxPage, value + 1))} disabled={page >= maxPage}>下一页</Button>
              </div>
            </>
          )}
        </Card>

        <Card title="城市分布" compact>
          {stats.loading ? <Skeleton height={180} /> : byCity.length > 0
            ? <BarList items={byCity} />
            : <Empty title="暂无分布" hint="有投递数据后显示" />}
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
        <Icon name="export" size={12} />
        导出会带上当前筛选条件，最多 5 万行；字段已跨平台归一化。「合并导出」把四个平台放进同一张表。
      </div>
    </div>
  )
}
