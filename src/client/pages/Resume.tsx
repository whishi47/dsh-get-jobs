/**
 * Resume page: import a text-based resume, review the generated draft, then
 * write it back. OCR is explicitly out of scope — scanned files are rejected
 * with a readable reason instead of a silent empty draft.
 * @module dsh-get-jobs/client/pages/resume
 */
import React, { useRef, useState } from 'react'

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

/** Two-step flow: parse → review → apply. */
export function Resume(): React.ReactElement {
  const backend = useBackend()
  const api = backend.api
  const [busy, setBusy] = useState<'parse' | 'apply' | undefined>(undefined)
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [meta, setMeta] = useState<ParsedMeta | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  const profile = useResource(
    async () => (api ? api.aiProfile() : undefined),
    [backend.revision, api?.baseUrl],
  )

  async function upload(file: File): Promise<void> {
    if (!api) return
    setBusy('parse')
    setError(undefined)
    setNotice(undefined)
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

  const notes = draft?.notes ?? []

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
          tone="primary"
          icon="upload"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== undefined || !api}
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

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
        <Icon name="alert" size={12} />
        解析使用你在「设置」里配置的大模型接口；简历只抽纯文本、不保存原始文件，原文也不会进日志。
      </div>
    </div>
  )
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
