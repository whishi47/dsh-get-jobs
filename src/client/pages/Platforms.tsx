/**
 * Platform configuration editor.
 *
 * Fields are data-driven. Most of them store **codes**, not text — `cityCode`
 * is `101280100`, `salary` is `405`, `degree` is `203`. The backend ships the
 * code table alongside every config read, so those fields render as pickers;
 * a text box would be unusable no matter how good the hint is.
 * @module dsh-get-jobs/client/pages/platforms
 */
import React, { useEffect, useRef, useState } from 'react'

import { PLATFORMS, type ConfigBundle, type Option, type Platform, type ResumeImageMeta } from '../api.js'
import { Badge, Button, Card, CodePicker, ErrorState, Field, Input, Skeleton, Spacer, Tabs, Textarea, Toggle } from '../components.js'
import { useBackend, useResource } from '../hooks.js'
import { pageStyle, tokens } from '../theme.js'

type FieldType = 'text' | 'long' | 'int' | 'bool' | 'list' | 'multi' | 'select'

interface FieldDef {
  key: string
  label: string
  type: FieldType
  hint?: string
  /** Key in the platform's option table; `multi` / `select` need it. */
  optionKey?: string
}

/** Fields that matter to a daily workflow, in the order they are edited. */
const FIELDS: Record<Platform, FieldDef[]> = {
  boss: [
    { key: 'keywords', label: '搜索关键词', type: 'list', hint: '逗号分隔，例如 Java,大模型,Agent' },
    // 后端的 normalizeCityToName 只取第一个城市，多选会被静默丢弃，所以这里做单选
    { key: 'cityCode', label: '城市', type: 'select', optionKey: 'city', hint: '单选；Boss 侧只保存第一个城市' },
    { key: 'salary', label: '薪资范围', type: 'multi', optionKey: 'salary', hint: '可多选' },
    { key: 'experience', label: '经验要求', type: 'multi', optionKey: 'experience' },
    { key: 'degree', label: '学历要求', type: 'multi', optionKey: 'degree' },
    { key: 'jobType', label: '职位类型', type: 'multi', optionKey: 'jobType' },
    { key: 'industry', label: '行业', type: 'multi', optionKey: 'industry' },
    { key: 'scale', label: '公司规模', type: 'multi', optionKey: 'scale' },
    { key: 'stage', label: '融资阶段', type: 'multi', optionKey: 'stage' },
    { key: 'expectedSalaryMin', label: '期望薪资下限（K）', type: 'int' },
    { key: 'expectedSalaryMax', label: '期望薪资上限（K）', type: 'int' },
    { key: 'waitTime', label: '页面操作等待（秒）', type: 'int' },
    { key: 'sayHi', label: '默认打招呼语', type: 'long', hint: 'AI 关闭或返回为空时使用' },
    { key: 'enableAi', label: 'AI 生成打招呼语', type: 'bool' },
    { key: 'sendImgResume', label: '发送图片简历', type: 'bool' },
    { key: 'filterDeadHr', label: '过滤不活跃 HR', type: 'bool' },
    { key: 'allowRepeatChat', label: '向已沟通 Boss 再次发消息', type: 'bool' },
  ],
  liepin: [
    { key: 'keywords', label: '搜索关键词', type: 'list', hint: '逗号分隔' },
    { key: 'city', label: '城市', type: 'select', optionKey: 'city' },
    { key: 'salaryCode', label: '薪资代码', type: 'text', hint: '留空表示不限；猎聘未提供薪资码表' },
  ],
  '51job': [
    { key: 'keywords', label: '搜索关键词', type: 'list', hint: '逗号分隔' },
    { key: 'jobArea', label: '工作地区', type: 'select', optionKey: 'jobArea' },
    { key: 'salary', label: '薪资范围', type: 'select', optionKey: 'salary' },
  ],
  zhilian: [
    { key: 'keywords', label: '搜索关键词', type: 'list', hint: '逗号分隔' },
    { key: 'cityCode', label: '城市', type: 'select', optionKey: 'city' },
    { key: 'salary', label: '薪资范围', type: 'text', hint: '留空表示不限；智联未提供薪资码表' },
  ],
}

/** Editable value: text/number for scalars, string[] for multi selections. */
type Editable = string | boolean | number | string[]

/** Split a stored bracket list ("[a,b]" / "a,b") into clean items. */
function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  const text = String(value ?? '').trim()
  if (!text) return []
  return text
    .replace(/^\[|\]$/g, '')
    .split(/[,，]/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

/**
 * Turn a stored value into an editable one.
 *
 * The database stores **names** (`上海`, `[20-50K]`) while the option tables key
 * on codes. Resolving names to codes on read means the picker, the "dirty"
 * comparison, and the request body all speak one language — and duplicate
 * entries like `[不限,不限]` collapse instead of rendering two identical chips.
 */
function toEditable(value: unknown, type: FieldType, options: Array<{ name: string; code: string }> = []): Editable {
  if (type === 'bool') return Number(value ?? 0) === 1
  if (type === 'int') return value === undefined || value === null || value === '' ? '' : Number(value)

  if (type === 'multi' || type === 'select' || type === 'list') {
    const items = splitList(value)
    if (type === 'list') return items
    const resolved = items.map((item) => {
      if (options.some((option) => option.code === item)) return item
      const byName = options.find((option) => option.name === item)
      return byName ? byName.code : item
    })
    const unique = [...new Set(resolved)]
    return type === 'select' ? (unique[0] ?? '') : unique
  }
  return String(value ?? '')
}

/**
 * Convert an editable value into the **exact JSON type the entity declares**.
 *
 * `BossConfigEntity` stores every list-ish field as `String`, so sending an
 * array makes Jackson reject the whole request with 400. Comma-joined is the
 * form `parseListString` / `normalizeKeywords` already understand — and the
 * backend converts codes back to names before writing.
 */
function toWire(value: Editable, type: FieldType): unknown {
  if (type === 'bool') return value === true ? 1 : 0
  if (type === 'int') {
    const raw = String(value).trim()
    return raw === '' ? null : Number(raw)
  }
  if (type === 'multi' || type === 'select' || type === 'list') {
    const items = Array.isArray(value) ? value : splitList(value)
    return items.join(',')
  }
  return String(value ?? '')
}

/** Stable comparison key used for the "unsaved changes" badge. */
function fingerprint(value: unknown, type: FieldType, options: Array<{ name: string; code: string }> = []): string {
  return JSON.stringify(toWire(toEditable(value, type, options), type))
}

/** View model for one platform read. */
interface View {
  config: Record<string, unknown>
  options: Record<string, Option[]>
}

/** Four-tab form over the platform configuration rows. */
export function Platforms(): React.ReactElement {
  const backend = useBackend()
  const api = backend.api
  const [platform, setPlatform] = useState<Platform>('boss')
  const [form, setForm] = useState<Record<string, Editable>>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)

  // sayHi 的 AI 润色
  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState<string | undefined>(undefined)

  // Boss 图片简历上传
  const [imageMeta, setImageMeta] = useState<ResumeImageMeta | undefined>(undefined)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageError, setImageError] = useState<string | undefined>(undefined)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const resource = useResource(
    async (): Promise<View | undefined> => {
      if (!api) return undefined
      const bundle: ConfigBundle = await api.config(platform)
      return { config: bundle.config, options: bundle.options }
    },
    [backend.revision, api?.baseUrl, platform],
  )

  // 数据回来时灌表单。**不动 savedAt**：保存成功后自己也会 reload，之前就是
  // 这里把刚设好的"已保存"提示立刻清掉了，用户完全看不到反馈。
  useEffect(() => {
    if (!resource.data) return
    const next: Record<string, Editable> = {}
    for (const field of FIELDS[platform]) {
      const table = field.optionKey ? resource.data.options[field.optionKey] ?? [] : []
      next[field.key] = toEditable(resource.data.config[field.key], field.type, table)
    }
    setForm(next)
    setSaveError(undefined)
  }, [resource.data])

  // 切换平台才算"换了一页"，此时清掉上一页的成功提示
  useEffect(() => {
    setSavedAt(undefined)
  }, [platform])

  // Boss tab 加载时探测图片简历是否已上传（content 接口 200=有，404=没有）
  useEffect(() => {
    if (platform !== 'boss' || !api) { setImageMeta(undefined); return }
    let cancelled = false
    fetch(`${api.baseUrl}/api/boss/config/resume-image/content`, { method: 'HEAD' })
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setImageMeta({ exists: true, previewUrl: `${api.baseUrl}/api/boss/config/resume-image/content` })
        } else {
          setImageMeta({ exists: false })
        }
      })
      .catch(() => { if (!cancelled) setImageMeta({ exists: false }) })
    return () => { cancelled = true }
  }, [platform, api?.baseUrl])

  /** AI 润色 sayHi：调 GET /api/ai/chat，把回复填回表单 */
  async function polishSayHi(): Promise<void> {
    if (!api) return
    const current = String(form['sayHi'] ?? '').trim()
    if (!current) { setPolishError('招呼语为空，请先填写再润色'); return }
    setPolishing(true)
    setPolishError(undefined)
    try {
      const polished = await api.aiPolish(current)
      setForm((prev) => ({ ...prev, sayHi: polished }))
    } catch (caught) {
      setPolishError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPolishing(false)
    }
  }

  /** 上传图片简历 */
  async function uploadImage(file: File): Promise<void> {
    if (!api) return
    setUploadingImage(true)
    setImageError(undefined)
    try {
      const meta = await api.uploadResumeImage(file)
      // 上传成功后刷新预览（加时间戳防缓存）
      setImageMeta({ ...meta, previewUrl: meta.exists ? `${api.baseUrl}/api/boss/config/resume-image/content?t=${Date.now()}` : undefined })
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setUploadingImage(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  const optionsFor = (field: FieldDef): Array<{ name: string; code: string }> =>
    (field.optionKey ? resource.data?.options[field.optionKey] ?? [] : [])

  const dirty = resource.data
    ? FIELDS[platform].some((field) =>
      fingerprint(resource.data?.config[field.key], field.type, optionsFor(field))
      !== fingerprint(form[field.key] ?? '', field.type, optionsFor(field)))
    : false

  async function save(): Promise<void> {
    if (!api) return
    setSaving(true)
    setSaveError(undefined)
    try {
      const patch: Record<string, unknown> = {}
      for (const field of FIELDS[platform]) {
        const value = toWire(form[field.key] ?? '', field.type)
        if (value !== null && value !== undefined) patch[field.key] = value
      }
      await api.saveConfig(platform, patch)
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
      resource.reload()
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  const options = resource.data?.options ?? {}

  // 与设置页同款：头部与平台 Tabs 固定，Tabs 以下的内容在自己的容器里滚动。
  // 容器必须是可收缩的 flex item（overflow:auto → 自动最小尺寸 0），内容自然
  // 高度超出时由本容器出滚动条；Card 已带 flexShrink:0 保持自然高度
  const tabScrollStyle: React.CSSProperties = {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.space(4),
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: tokens.font.xl, fontWeight: 600 }}>投递配置</h2>
        {dirty ? <Badge tone="warning">有未保存改动</Badge> : savedAt ? <Badge tone="success">已保存 {savedAt}</Badge> : null}
        <Spacer />
        <Button icon="refresh" onClick={resource.reload} disabled={resource.loading}>重新读取</Button>
        <Button tone="primary" onClick={save} disabled={!dirty || saving || !api}>{saving ? '保存中…' : '保存'}</Button>
      </div>

      <Tabs
        items={PLATFORMS.map((item) => ({
          value: item.id,
          label: item.label,
          badge: item.maintained ? undefined : <span style={{ fontSize: 10, color: tokens.color.textFaint }}>停维护</span>,
        }))}
        value={platform}
        onChange={setPlatform}
      />

      <div style={tabScrollStyle}>
      {savedAt && !dirty ? (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px',
            borderRadius: tokens.radius.md,
            border: `1px solid ${tokens.color.success}`,
            background: tokens.color.successSoft,
            fontSize: tokens.font.sm,
          }}
        >
          <Badge tone="success">已保存</Badge>
          <span style={{ flex: 1, minWidth: 0 }}>
            配置已写入数据库，下次启动投递时生效。
          </span>
          <span style={{ color: tokens.color.textFaint, flexShrink: 0 }}>{savedAt}</span>
        </div>
      ) : null}

      {saveError ? <ErrorState message={saveError} onRetry={save} /> : null}
      {resource.error ? <ErrorState message={resource.error} onRetry={resource.reload} /> : null}

      <Card title={`${PLATFORMS.find((item) => item.id === platform)?.label} 参数`}>
        {resource.loading ? <Skeleton height={260} /> : (
          <div style={{
            display: 'grid',
            // 字段少的平台（猎聘/51job/智联只有 3 个）用单列，两列会右半空缺、错行
            gridTemplateColumns: FIELDS[platform].length <= 4 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
            gap: tokens.space(3),
          }}>
            {FIELDS[platform].map((field) => {
              const value = form[field.key]

              if (field.type === 'bool') {
                // sendImgResume 开关旁边加上传图片入口 + 缩略图预览
                const isImageField = field.key === 'sendImgResume'
                return (
                  <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Toggle
                        checked={value === true}
                        label={field.label}
                        onChange={(next) => setForm((prev) => ({ ...prev, [field.key]: next }))}
                      />
                      <span style={{ fontSize: tokens.font.md }}>{field.label}</span>
                    </div>
                    {isImageField ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/gif"
                          style={{ display: 'none' }}
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (file) void uploadImage(file)
                          }}
                        />
                        <Button icon="upload" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage || !api}>
                          {uploadingImage ? '上传中…' : imageMeta?.exists ? '更换图片' : '上传图片'}
                        </Button>
                        {imageMeta?.exists ? (
                          <img
                            src={imageMeta.previewUrl}
                            alt="简历图片"
                            style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: tokens.radius.sm, border: `1px solid ${tokens.color.border}` }}
                          />
                        ) : (
                          <span style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
                            {imageMeta ? '未上传，开关打开也会跳过' : ''}
                          </span>
                        )}
                        {imageError ? <span style={{ fontSize: tokens.font.xs, color: tokens.color.danger }}>{imageError}</span> : null}
                      </div>
                    ) : null}
                  </div>
                )
              }

              if (field.type === 'long') {
                // sayHi 字段旁边加 AI 润色按钮
                const isSayHi = field.key === 'sayHi'
                return (
                  <div key={field.key} style={{ gridColumn: '1 / -1' }}>
                    <Field label={field.label} hint={field.hint}>
                      <Textarea
                        value={String(value ?? '')}
                        onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                      />
                    </Field>
                    {isSayHi ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <Button icon="check" tone="primary" onClick={polishSayHi} disabled={polishing || !api || !String(form['sayHi'] ?? '').trim()}>
                          {polishing ? 'AI 润色中…' : 'AI 润色'}
                        </Button>
                        {polishError ? <span style={{ fontSize: tokens.font.xs, color: tokens.color.danger }}>{polishError}</span> : null}
                        <span style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
                          调用你配置的大模型润色招呼语
                        </span>
                      </div>
                    ) : null}
                  </div>
                )
              }

              if (field.type === 'multi' || field.type === 'select') {
                const table = field.optionKey ? options[field.optionKey] ?? [] : []
                const current = Array.isArray(value) ? value : (String(value ?? '') ? [String(value)] : [])
                // 码表缺失时退回文本框，至少不会卡住用户
                if (table.length === 0) {
                  return (
                    <Field key={field.key} label={field.label} hint={field.hint ?? '码表未提供，可直接填代码'}>
                      <Input
                        value={current.join(',')}
                        onChange={(event) => setForm((prev) => ({
                          ...prev,
                          [field.key]: field.type === 'multi'
                            ? event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
                            : event.target.value,
                        }))}
                      />
                    </Field>
                  )
                }
                return (
                  <Field key={field.key} label={field.label} hint={field.hint ?? `共 ${table.length} 项可选`}>
                    <CodePicker
                      value={current}
                      options={table}
                      multiple={field.type === 'multi'}
                      onChange={(next) => setForm((prev) => ({
                        ...prev,
                        [field.key]: field.type === 'multi' ? next : (next[0] ?? ''),
                      }))}
                    />
                  </Field>
                )
              }

              if (field.type === 'list') {
                const text = Array.isArray(value) ? value.join(',') : String(value ?? '')
                return (
                  <Field key={field.key} label={field.label} hint={field.hint}>
                    <Input
                      value={text}
                      onChange={(event) => setForm((prev) => ({
                        ...prev,
                        [field.key]: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
                      }))}
                    />
                  </Field>
                )
              }

              return (
                <Field key={field.key} label={field.label} hint={field.hint}>
                  <Input
                    value={String(value ?? '')}
                    inputMode={field.type === 'int' ? 'numeric' : undefined}
                    onChange={(event) => setForm((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  />
                </Field>
              )
            })}
          </div>
        )}
      </Card>

      <div style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
        保存后将在下一次启动投递时生效。城市、薪资、经验、学历这些字段存的是平台代码，用下拉选择即可，不需要记数字。
      </div>
      </div>
    </div>
  )
}
