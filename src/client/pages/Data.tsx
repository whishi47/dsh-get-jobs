/**
 * Data page: filters, KPI, distribution bars, paged rows, and export.
 * @module dsh-get-jobs/client/pages/data
 */
import React, { useMemo, useState } from 'react'

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

  const query = useMemo(() => {
    const base: Record<string, string | number> = { page, size: PAGE_SIZE }
    if (keyword.trim()) base['keyword'] = keyword.trim()
    if (status.trim()) base['statuses'] = status.trim()
    return base
  }, [keyword, status, page])

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
