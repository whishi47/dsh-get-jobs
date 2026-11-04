/**
 * Resume page: import a text-based resume, review the generated draft, then
 * write it back. Also scores the resume and exports a standalone HTML report.
 * OCR is explicitly out of scope — scanned files are rejected with a readable
 * reason instead of a silent empty draft.
 * @module dsh-get-jobs/client/pages/resume
 */
import React, { useRef, useState } from 'react'

import type { ResumeEvaluation, ResumeImageResult } from '../api.js'
import { Badge, Button, Card, Empty, ErrorState, Field, Icon, Skeleton, Spacer, Textarea } from '../components.js'
import { useBackend, useResource } from '../hooks.js'
import { pageStyle, tokens } from '../theme.js'

/** Draft shape returned by `POST /api/resume/parse`. */
interface Draft {
  introduce?: string
  prompt?: string
  sayHi?: string
  keywords?: string[]
  cities?: string[]
  notes?: string[]
}

/** Extra facts about the upload, shown as a subtitle. */
interface ParsedMeta {
  format?: string
  pages?: number
  chars?: number
  truncated?: boolean
}

/**
 * Read a JSON error body, falling back to the raw text.
 *
 * 413 由容器在进 controller 之前抛出，body 是空的，所以按状态码补一句可读提示，
 * 否则用户只会看到"解析失败（413）"。
 */
async function errorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text()
  if (response.status === 413) return '文件超过 10 MB，请压缩后再导入。'
  try {
    const parsed = JSON.parse(text) as { message?: string }
    if (parsed.message) return parsed.message
  } catch {
    /* not JSON — fall through to the raw body */
  }
  return text && text.length < 300 ? text : fallback
}

/** Two-step flow: parse → review → apply. Plus scoring and report export. */
export function Resume(): React.ReactElement {
  const backend = useBackend()
  const api = backend.api
  const [busy, setBusy] = useState<'parse' | 'apply' | 'evaluate' | undefined>(undefined)
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [meta, setMeta] = useState<ParsedMeta | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [evaluation, setEvaluation] = useState<ResumeEvaluation | undefined>(undefined)
  const [evalError, setEvalError] = useState<string | undefined>(undefined)
  const [fileName, setFileName] = useState<string | undefined>(undefined)
  const [imaging, setImaging] = useState(false)
  const [imageResult, setImageResult] = useState<ResumeImageResult | undefined>(undefined)
  const [imageError, setImageError] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  // 评估要重新上传原始文件（后端不保存简历），所以这里留住最近一次选择
  const lastFile = useRef<File | undefined>(undefined)

  const profile = useResource(
    async () => (api ? api.aiProfile() : undefined),
    [backend.revision, api?.baseUrl],
  )

  async function upload(file: File): Promise<void> {
    if (!api) return
    setBusy('parse')
    setError(undefined)
    setNotice(undefined)
    setEvalError(undefined)
    lastFile.current = file
    setFileName(file.name)
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch(`${api.baseUrl}/api/resume/parse`, { method: 'POST', body })
      if (!response.ok) throw new Error(await errorMessage(response, `解析失败（${response.status}）`))
      const payload = await response.json() as { draft?: Draft; meta?: ParsedMeta }
      setDraft(payload.draft ?? {})
      setMeta(payload.meta)
      setNotice(`已解析 ${file.name}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(undefined)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function apply(): Promise<void> {
    if (!api || !draft) return
    setBusy('apply')
    setError(undefined)
    try {
      const response = await fetch(`${api.baseUrl}/api/ai/apply-draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          introduce: draft.introduce ?? '',
          prompt: draft.prompt ?? '',
          sayHi: draft.sayHi ?? '',
          keywords: draft.keywords ?? [],
        }),
      })
      if (!response.ok) throw new Error(await errorMessage(response, `写回失败（${response.status}）`))
      const payload = await response.json() as { message?: string }
      setNotice(payload.message ?? '已写回 AI 配置')
      profile.reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(undefined)
    }
  }

  /** 让模型给简历打分。耗时通常 10-30 秒，期间按钮与卡片都显示 loading。 */
  async function evaluate(): Promise<void> {
    if (!api || !lastFile.current) {
      setEvalError('请先导入一份简历，再开始评估。')
      return
    }
    setBusy('evaluate')
    setEvalError(undefined)
    setNotice(undefined)
    try {
      const payload = await api.evaluateResume(lastFile.current)
      setEvaluation(payload.evaluation)
      setNotice(`评估完成：${payload.evaluation.score} 分`)
    } catch (caught) {
      setEvalError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(undefined)
    }
  }

  /** 导出一份可独立打开的 HTML 报告（可再打印成 PDF）。 */
  function downloadReport(): void {
    if (!evaluation) return
    const html = buildReportHtml(evaluation, fileName)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    if (typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `简历评估报告-${new Date().toISOString().slice(0, 10)}.html`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /**
   * 把简历排成长图，并直接写成 Boss 图片简历。
   *
   * 一个请求做两件事：后端渲染 + 落盘到和手动上传同一个位置。所以生成完
   * 投递时勾着「发送图片简历」就会发这张图，不需要用户再去投递配置页传一次。
   */
  async function generateImage(): Promise<void> {
    if (!api || !lastFile.current) {
      setImageError('请先导入一份简历，再生成。')
      return
    }
    setImaging(true)
    setImageError(undefined)
    setNotice(undefined)
    try {
      const payload = await api.generateResumeImage(lastFile.current)
      setImageResult(payload)
      setNotice(`长图已生成并同步到 Boss 图片简历（${payload.image.width}×${payload.image.height}）`)
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setImaging(false)
    }
  }

  /** 下载长图到本地；跨域下 `a[download]` 会被忽略，所以先取 blob。 */
  async function downloadLongImage(): Promise<void> {
    if (!api || !imageResult) return
    try {
      const response = await fetch(`${api.baseUrl}${imageResult.image.previewUrl}`)
      if (!response.ok) throw new Error(`下载失败（${response.status}）`)
      const blob = await response.blob()
      if (typeof URL.createObjectURL !== 'function') return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `简历长图.${imageResult.image.format === 'jpg' ? 'jpg' : 'png'}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const notes = draft?.notes ?? []
  const evaluating = busy === 'evaluate'

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: tokens.font.xl, fontWeight: 600 }}>简历</h2>
        {notice ? <Badge tone="success">{notice}</Badge> : null}
        <Spacer />
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
          }}
        />
        <Button
          icon="check"
          onClick={evaluate}
          disabled={busy !== undefined || imaging || !api || !fileName}
          title={fileName ? '让 AI 给这份简历打分' : '先导入简历'}
        >
          {evaluating ? 'AI 评估中…' : 'AI 评估打分'}
        </Button>
        <Button
          tone="primary"
          icon="upload"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== undefined || imaging || !api}
        >
          {busy === 'parse' ? '解析中…' : '导入简历'}
        </Button>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: tokens.space(3) }}>
        <Card title="当前 AI 配置">
          {profile.loading ? <Skeleton height={80} /> : profile.data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
              <Field label="自我介绍（introduce）">
                <div style={readonlyBox(90)}>{profile.data.introduce || '（空）'}</div>
              </Field>
              <Field label="打招呼提示词（prompt）">
                <div style={readonlyBox(120)}>{profile.data.prompt || '（空）'}</div>
              </Field>
            </div>
          ) : <Empty title="读取不到 AI 配置" hint="确认后端已启动" action={<Button onClick={profile.reload}>重试</Button>} />}
        </Card>

        <Card
          title="解析草稿"
          actions={draft ? (
            <Button tone="primary" icon="check" onClick={apply} disabled={busy !== undefined}>
              {busy === 'apply' ? '写回中…' : '写回配置'}
            </Button>
          ) : undefined}
          compact
        >
          {!draft ? (
            <Empty
              title="还没有解析结果"
              hint="支持文本型 PDF、DOCX、TXT、MD，10 MB 以内。扫描件不在本期支持范围内。"
              action={<Button icon="upload" onClick={() => inputRef.current?.click()}>选择文件</Button>}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
              {meta ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
                  <Badge tone="neutral">{meta.format ?? '未知格式'}</Badge>
                  {meta.pages ? <Badge tone="neutral">{meta.pages} 页</Badge> : null}
                  <Badge tone="neutral">{meta.chars ?? 0} 字</Badge>
                  {meta.truncated ? <Badge tone="warning">已截断</Badge> : null}
                </div>
              ) : null}

              {notes.length > 0 ? (
                <div style={{
                  padding: '8px 10px',
                  borderRadius: tokens.radius.md,
                  border: `1px solid ${tokens.color.border}`,
                  background: tokens.color.surface,
                  fontSize: tokens.font.sm,
                  color: tokens.color.textMuted,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}>
                  {notes.map((note) => <div key={note}>· {note}</div>)}
                </div>
              ) : null}

              <Field label="自我介绍" hint="可直接编辑，写回时以此为准；留空表示不修改">
                <Textarea
                  value={draft.introduce ?? ''}
                  onChange={(event) => setDraft({ ...draft, introduce: event.target.value })}
                />
              </Field>

              <Field label="打招呼提示词" hint="Boss 的 AI 打招呼读这一条">
                <Textarea
                  value={draft.prompt ?? ''}
                  onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                />
              </Field>

              <Field label="固定开场白" hint="关闭 AI 时使用，写入 boss_config.say_hi">
                <Textarea
                  value={draft.sayHi ?? ''}
                  rows={3}
                  onChange={(event) => setDraft({ ...draft, sayHi: event.target.value })}
                />
              </Field>

              {draft.keywords && draft.keywords.length > 0 ? (
                <Field label="推荐关键词" hint="写回后覆盖 boss_config.keywords">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {draft.keywords.map((keyword) => <Badge key={keyword} tone="accent">{keyword}</Badge>)}
                  </div>
                </Field>
              ) : null}

              {draft.cities && draft.cities.length > 0 ? (
                <Field label="推荐城市" hint="城市码需要对照表，请到「投递配置」页选择">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {draft.cities.map((city) => <Badge key={city} tone="neutral">{city}</Badge>)}
                  </div>
                </Field>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="简历评估"
        actions={evaluation ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button onClick={evaluate} disabled={busy !== undefined} icon="refresh">
              {evaluating ? '评估中…' : '重新评估'}
            </Button>
            <Button tone="primary" icon="export" onClick={downloadReport} disabled={evaluating}>
              导出 HTML 报告
            </Button>
          </div>
        ) : undefined}
        compact
      >
        {evaluating ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
              <Badge tone="accent">AI 评估中</Badge>
              <span>正在逐条阅读简历、对照评分维度，通常需要 10-30 秒，请不要关闭面板。</span>
            </div>
            <Skeleton height={24} width="40%" />
            <Skeleton height={12} />
            <Skeleton height={12} width="85%" />
            <Skeleton height={12} width="70%" />
          </div>
        ) : evalError ? (
          <ErrorState message={evalError} onRetry={fileName ? evaluate : undefined} />
        ) : !evaluation ? (
          <Empty
            title="还没有评估结果"
            hint={fileName
              ? `已就绪：${fileName}。点击「AI 评估打分」，AI 会给总分、分项评价和修改建议。`
              : '先导入一份简历，再让 AI 打分。评估会消耗 1 次大模型调用。'}
            action={(
              <Button icon="upload" onClick={() => inputRef.current?.click()}>
                {fileName ? '换一份简历' : '选择文件'}
              </Button>
            )}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(4) }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 42, lineHeight: 1, fontWeight: 700, color: scoreColor(evaluation.score) }}>
                  {evaluation.score}
                </span>
                <span style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>/ 100</span>
              </div>
              <Badge tone={scoreTone(evaluation.score)}>{evaluation.level || '—'}</Badge>
              <div style={{ flex: '1 1 240px', minWidth: 200, fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
                {evaluation.summary || '（模型没有给出总评）'}
              </div>
              {evaluation.generatedAt ? (
                <span style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>{evaluation.generatedAt}</span>
              ) : null}
            </div>

            {evaluation.dimensions.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: tokens.space(3) }}>
                {evaluation.dimensions.map((dimension) => (
                  <div key={dimension.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: tokens.font.sm }}>
                      <span>{dimension.name}</span>
                      <strong style={{ color: scoreColor(dimension.score) }}>{dimension.score}</strong>
                    </div>
                    <div style={{ height: 6, marginTop: 5, borderRadius: 999, background: tokens.color.surfaceAlt }}>
                      <div style={{
                        width: `${clampScore(dimension.score)}%`,
                        height: '100%',
                        borderRadius: 999,
                        background: scoreColor(dimension.score),
                      }} />
                    </div>
                    {dimension.comment ? (
                      <div style={{ marginTop: 5, fontSize: tokens.font.xs, color: tokens.color.textMuted }}>
                        {dimension.comment}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: tokens.space(3) }}>
              <ListBlock title="优势" tone="success" items={evaluation.strengths} />
              <ListBlock title="待改进" tone="warning" items={evaluation.issues} />
              <ListBlock title="修改建议" tone="accent" items={evaluation.suggestions} />
            </div>

            {(evaluation.keywords.hit.length > 0 || evaluation.keywords.missing.length > 0) ? (
              <div>
                <div style={{ fontSize: tokens.font.sm, fontWeight: 600, color: tokens.color.textMuted, marginBottom: 6 }}>
                  关键词
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {evaluation.keywords.hit.map((keyword) => (
                    <Badge key={`hit-${keyword}`} tone="success">{keyword}</Badge>
                  ))}
                  {evaluation.keywords.missing.map((keyword) => (
                    <Badge key={`miss-${keyword}`} tone="warning">缺 {keyword}</Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {evaluation.truncated ? (
              <div style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
                简历较长，评估只覆盖了前 8000 字。
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card
        title="简历长图"
        actions={imageResult ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button icon="refresh" onClick={generateImage} disabled={imaging || busy !== undefined}>
              {imaging ? '生成中…' : '重新生成'}
            </Button>
            <Button tone="primary" icon="export" onClick={downloadLongImage} disabled={imaging}>
              下载长图
            </Button>
          </div>
        ) : undefined}
        compact
      >
        {imaging ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space(3) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
              <Badge tone="accent">生成长图中</Badge>
              <span>正在把简历排成 1080 宽的长图并写入 Boss 图片简历，通常 3-10 秒。</span>
            </div>
            <Skeleton height={220} />
          </div>
        ) : imageError ? (
          <ErrorState message={imageError} onRetry={fileName ? generateImage : undefined} />
        ) : !imageResult ? (
          <Empty
            title="还没有生成长图"
            hint={fileName
              ? `已就绪：${fileName}。生成后会自动写入 Boss 图片简历，投递时勾选「发送图片简历」就会发这张图。`
              : '先导入一份简历，再生成。'}
            action={(
              <Button icon="upload" onClick={generateImage} disabled={!fileName || busy !== undefined}>
                生成长图并同步到 Boss
              </Button>
            )}
          />
        ) : (
          <div style={{ display: 'flex', gap: tokens.space(4), alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <img
              src={`${api?.baseUrl ?? ''}${imageResult.image.previewUrl}?t=${imageResult.image.updatedAt ?? imageResult.image.size}`}
              alt="简历长图预览"
              style={{
                width: 220,
                maxHeight: 420,
                objectFit: 'contain',
                objectPosition: 'top',
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.md,
                background: '#ffffff',
              }}
            />
            <div style={{ flex: '1 1 260px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Badge tone="success">已同步到 Boss 图片简历</Badge>
                <Badge tone="neutral">{imageResult.image.width} × {imageResult.image.height}</Badge>
                <Badge tone="neutral">{formatBytes(imageResult.image.size)}</Badge>
                {imageResult.image.truncated ? <Badge tone="warning">过长已截断</Badge> : null}
              </div>
              <div style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>
                投递时只要在「投递配置 → Boss 直聘」里勾选「发送图片简历」，就会发送这张长图；
                不需要再去手动上传一次。
              </div>
              <div style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
                白底长图、手机查看清晰；如需调整文字，先在下方「解析草稿」里改，再回来重新生成。
              </div>
            </div>
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
        <Icon name="alert" size={12} />
        解析与评估使用你在「设置」里配置的大模型接口；长图由后端本地渲染，不上传第三方服务。简历只抽纯文本、不保存原始文件，原文也不会进日志。
      </div>
    </div>
  )
}

/** One component column in the evaluation card. */
function ListBlock({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'success' | 'warning' | 'accent'
  items: string[]
}): React.ReactElement | null {
  if (items.length === 0) return null
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: tokens.radius.md,
      border: `1px solid ${tokens.color.border}`,
      background: tokens.color.surface,
    }}>
      <div style={{ marginBottom: 6 }}><Badge tone={tone}>{title}</Badge></div>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item) => (
          <li key={item} style={{ fontSize: tokens.font.sm, color: tokens.color.text }}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

/** `1234567` → `1.2 MB`; used for the generated long image. */
function formatBytes(value: number | undefined): string {
  const bytes = Number(value ?? 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function scoreColor(value: number): string {
  const score = clampScore(value)
  if (score >= 85) return tokens.color.success
  if (score >= 70) return tokens.color.accent
  if (score >= 60) return tokens.color.warning
  return tokens.color.danger
}

function scoreTone(value: number): 'success' | 'accent' | 'warning' | 'danger' {
  const score = clampScore(value)
  if (score >= 85) return 'success'
  if (score >= 70) return 'accent'
  if (score >= 60) return 'warning'
  return 'danger'
}

/** Read-only block used for the current profile previews. */
function readonlyBox(maxHeight: number): React.CSSProperties {
  return {
    padding: '6px 9px',
    borderRadius: tokens.radius.md,
    border: `1px solid ${tokens.color.border}`,
    background: tokens.color.surface,
    maxHeight,
    overflow: 'auto',
    fontSize: tokens.font.sm,
    whiteSpace: 'pre-wrap',
  }
}

/** Escape model-provided text before dropping it into the exported HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Standalone report. Deliberately inline-styled with fixed light colors: the
 * file is opened outside the DSH panel, so it must not depend on theme vars.
 */
function buildReportHtml(evaluation: ResumeEvaluation, fileName?: string): string {
  const dimensions = evaluation.dimensions.map((dimension) => `
      <div class="dim">
        <div class="dim-head"><span>${escapeHtml(dimension.name)}</span><strong>${clampScore(dimension.score)}</strong></div>
        <div class="bar"><i style="width:${clampScore(dimension.score)}%;background:${scoreColor(dimension.score)}"></i></div>
        ${dimension.comment ? `<p class="muted">${escapeHtml(dimension.comment)}</p>` : ''}
      </div>`).join('')

  const block = (title: string, items: string[], accent: string): string => items.length === 0 ? '' : `
      <section class="block">
        <h3><span class="dot" style="background:${accent}"></span>${escapeHtml(title)}</h3>
        <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </section>`

  const keywords = [...evaluation.keywords.hit.map((keyword) => `<span class="tag ok">${escapeHtml(keyword)}</span>`),
    ...evaluation.keywords.missing.map((keyword) => `<span class="tag miss">缺 ${escapeHtml(keyword)}</span>`)].join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>简历评估报告 · ${evaluation.score} 分</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 20px; background: #f5f6f8; color: #1a1f2b;
         font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 760px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 36px 40px;
         box-shadow: 0 2px 16px rgba(16,24,40,.07); }
  header { border-bottom: 1px solid #e6e8ec; padding-bottom: 18px; margin-bottom: 24px; }
  h1 { margin: 0 0 6px; font-size: 20px; letter-spacing: .2px; }
  .sub { color: #6b7280; font-size: 12px; }
  .score-row { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
  .score { font-size: 54px; line-height: 1; font-weight: 700; }
  .score small { font-size: 14px; color: #9aa3af; font-weight: 400; }
  .level { padding: 2px 10px; border-radius: 999px; font-size: 12px; background: #eef2ff; color: #2f6feb; }
  .summary { color: #4b5563; margin: 4px 0 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin: 24px 0; }
  .dim-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px; }
  .bar { height: 6px; border-radius: 999px; background: #eef0f3; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 999px; }
  .muted { color: #9aa3af; font-size: 11px; margin: 5px 0 0; }
  .block { border: 1px solid #e6e8ec; border-radius: 10px; padding: 14px 16px; margin-top: 12px; }
  .block h3 { margin: 0 0 8px; font-size: 13px; display: flex; align-items: center; gap: 7px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .block ul { margin: 0; padding-left: 18px; }
  .block li { margin: 4px 0; }
  .tags { margin-top: 18px; display: flex; gap: 7px; flex-wrap: wrap; }
  .tag { font-size: 11px; padding: 2px 9px; border-radius: 999px; }
  .tag.ok { background: #e8f5ee; color: #2e7d5b; }
  .tag.miss { background: #fdf3e2; color: #a9761c; }
  footer { margin-top: 26px; padding-top: 14px; border-top: 1px solid #e6e8ec; color: #9aa3af; font-size: 11px; }
  @media print { body { background: #fff; padding: 0; } main { box-shadow: none; border-radius: 0; padding: 0; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>简历评估报告</h1>
    <div class="sub">${fileName ? `文件：${escapeHtml(fileName)} · ` : ''}生成时间：${escapeHtml(evaluation.generatedAt ?? new Date().toLocaleString('zh-CN'))}</div>
  </header>
  <div class="score-row">
    <div class="score" style="color:${scoreColor(evaluation.score)}">${evaluation.score}<small> / 100</small></div>
    <span class="level">${escapeHtml(evaluation.level || '—')}</span>
  </div>
  <p class="summary">${escapeHtml(evaluation.summary || '')}</p>
  ${dimensions ? `<div class="grid">${dimensions}</div>` : ''}
  ${block('优势', evaluation.strengths, '#2e7d5b')}
  ${block('待改进', evaluation.issues, '#b4801f')}
  ${block('修改建议', evaluation.suggestions, '#2f6feb')}
  ${keywords ? `<div class="tags">${keywords}</div>` : ''}
  <footer>本报告由 dsh-get-jobs 调用你配置的大模型生成，仅供参考，不构成录用承诺。 · mattan</footer>
</main>
</body>
</html>`
}
