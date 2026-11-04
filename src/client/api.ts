/**
 * Browser-side API layer. The panel is same-origin with the host, so the plugin
 * status route is always reachable; the Get Jobs backend itself is called
 * cross-origin on loopback (its controllers allow `*`).
 * @module dsh-get-jobs/client/api
 */

/** Platforms the backend exposes. */
export type Platform = 'boss' | 'liepin' | '51job' | 'zhilian'

/** Platform metadata used by tabs and labels. */
export const PLATFORMS: Array<{ id: Platform; label: string; maintained: boolean }> = [
  { id: 'boss', label: 'Boss直聘', maintained: true },
  { id: 'liepin', label: '猎聘', maintained: true },
  { id: '51job', label: '51job', maintained: false },
  { id: 'zhilian', label: '智联招聘', maintained: false },
]

/** Plugin health payload. */
export interface HealthPayload {
  plugin: string
  baseUrl: string
  reachable: boolean
  state: string
  managed: boolean
  pid?: number
  message: string
}

/** One platform's runtime status. */
export interface PlatformStatus {
  isRunning?: boolean
  isLoggedIn?: boolean
  success?: boolean
}

/** KPI block returned by the stats endpoints. */
export interface StatsPayload {
  kpi?: Record<string, number>
  charts?: Record<string, Array<{ name?: string; label?: string; value?: number }>>
}

/** One selectable value (raw code + display name). */
export interface Option {
  name: string
  code: string
}

/** Platform config plus the option tables that make the codes usable. */
export interface ConfigBundle {
  config: Record<string, unknown>
  options: Record<string, Option[]>
}

/** Result of asking the backend to open a platform's login page. */
export interface LoginTrigger {
  platform: string
  accepted: boolean
  message: string
}

/** Login state of one platform. */
export interface LoginState {
  platform: string
  isLoggedIn: boolean
  initialized: boolean
  opening: boolean
}

/** One AI usage bucket (today or current run). */
export interface AiUsageBucket {
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** AI usage plus the budget limits that produced it. */
export interface AiUsage {
  today: AiUsageBucket & { day?: string }
  run: AiUsageBucket
  limits: {
    run: number
    daily: number
    maxTokens: number
    disableThinking: boolean
    /** `off` = 关闭思考（最省），`auto` = 模型默认，`high` = 深度思考（最贵）。 */
    thinkingMode?: 'off' | 'auto' | 'high'
    greetingPool: boolean
    greetingBatch: number
  }
  model?: string
  thinkingSwitchSupported?: boolean
}

/** One platform's daily delivery quota row. */
export interface DeliveryQuotaPlatform {
  delivered: number
  /** 0 = 该平台不单独限制，只受合计目标约束。 */
  target: number
  /** -1 = 不限。 */
  remaining: number
  reached: boolean
}

/**
 * Today's delivery quota snapshot (`GET /api/delivery/quota`).
 *
 * 两级配额：`target` 是所有平台加起来的合计上限，`platforms[x].target` 是单平台上限，
 * 任一到达后端就会自动停投。
 */
export interface DeliveryQuota {
  day: string
  target: number
  delivered: number
  remaining: number
  reached: boolean
  byPlatform: Record<string, number>
  platforms?: Partial<Record<Platform, DeliveryQuotaPlatform>>
  /** 允许投递的时间段，如 `09:00 - 23:00`；空串表示全天。 */
  workHours: string
  inWorkHours: boolean
  serverTime?: string
}

/** One scoring dimension in a resume evaluation. */
export interface ResumeDimension {
  name: string
  score: number
  comment: string
}

/** Structured resume evaluation returned by the backend. */
export interface ResumeEvaluation {
  score: number
  level: string
  summary: string
  dimensions: ResumeDimension[]
  strengths: string[]
  issues: string[]
  suggestions: string[]
  keywords: { hit: string[]; missing: string[] }
  generatedAt?: string
  truncated?: boolean
}

/** Long image rendered from a resume and saved as the Boss resume image. */
export interface ResumeImageResult {
  image: {
    width: number
    height: number
    format: string
    fontSize?: number
    size: number
    contentType: string
    previewUrl: string
    truncated?: boolean
    updatedAt?: number
  }
  meta?: Record<string, unknown>
  savedToBoss: boolean
}

/** Metadata for the uploaded Boss resume image. */
export interface ResumeImageMeta {
  exists: boolean
  fileName?: string
  contentType?: string
  size?: number
  updatedAt?: number
  previewUrl?: string
}

/** Paged job rows. */
export interface PagedJobs {
  items: Array<Record<string, unknown>>
  total: number
  page: number
  size: number
}

/** Result of one backend call, normalized for the UI. */
export class ApiError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Fetch the plugin's own status route. */
export async function fetchHealth(): Promise<HealthPayload> {
  const response = await fetch('/dsh-get-jobs/health', { headers: { accept: 'application/json' } })
  if (!response.ok) throw new ApiError(`插件状态接口返回 ${response.status}`)
  return await response.json() as HealthPayload
}

/** JSON client bound to one backend base URL. */
export class JobsApi {
  constructor(public baseUrl: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError('无法连接后端', '后端进程可能未启动，或端口被占用')
    }
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = text
    }
    if (!response.ok) {
      const record = (parsed ?? {}) as Record<string, unknown>
      const serverMessage = typeof record['message'] === 'string' ? record['message'] : ''
      // Spring 的默认错误体里没有 message，只有 status/error/path。
      // 只显示"请求失败（400）"没法排查，这里至少把方法和路径带出来。
      const message = serverMessage || `${method} ${path} 返回 ${response.status}`
      throw new ApiError(message, response.statusText)
    }
    return parsed as T
  }

  /** Runtime status for one platform. */
  status(platform: Platform): Promise<PlatformStatus> {
    return this.call<PlatformStatus>('GET', `/api/${platform}/status`)
  }

  /**
   * Read one platform's configuration row together with its option tables.
   *
   * All four controllers return `{config, options}`. The options matter: fields
   * like `cityCode` / `salary` / `degree` store numeric codes, so a plain text
   * box would be unusable — the UI has to render them as pickers.
   */
  async config(platform: Platform): Promise<ConfigBundle> {
    const raw = await this.call<Record<string, unknown>>('GET', `/api/${platform}/config`)
    const config = (raw['config'] as Record<string, unknown>) ?? raw
    const options = (raw['options'] as Record<string, Option[]>) ?? {}
    return { config, options }
  }

  /** Selectively update one platform's configuration. */
  saveConfig(platform: Platform, patch: Record<string, unknown>): Promise<unknown> {
    return this.call('PUT', `/api/${platform}/config`, patch)
  }

  /** Start or stop a delivery run. */
  run(platform: Platform, action: 'start' | 'stop'): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>('POST', `/api/${platform}/${action}`)
  }

  /** Delivery KPIs and buckets. */
  stats(platform: Platform, query: Record<string, string | number> = {}): Promise<StatsPayload> {
    const suffix = Object.entries(query)
      .filter(([, value]) => value !== '' && value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')
    return this.call<StatsPayload>('GET', `/api/${platform}/stats${suffix ? `?${suffix}` : ''}`)
  }

  /** Paged job rows. */
  jobs(platform: Platform, query: Record<string, string | number> = {}): Promise<PagedJobs> {
    const suffix = Object.entries(query)
      .filter(([, value]) => value !== '' && value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')
    return this.call<PagedJobs>('GET', `/api/${platform}/list${suffix ? `?${suffix}` : ''}`)
  }

  /**
   * Ask the backend to navigate a platform to its login page and open the QR
   * panel. Returns immediately: the browser window takes up to 30 s to appear
   * the first time, so the caller polls {@link loginState} instead of waiting.
   */
  triggerLogin(platform: Platform): Promise<LoginTrigger> {
    return this.call<LoginTrigger>('POST', `/api/login/${platform}`)
  }

  /** Whether that platform has finished logging in. */
  loginState(platform: Platform): Promise<LoginState> {
    return this.call<LoginState>('GET', `/api/login/${platform}/status`)
  }

  /** Blacklist entries (Boss store). */
  blacklist(): Promise<Array<Record<string, unknown>>> {
    return this.call<Array<Record<string, unknown>>>('GET', '/api/boss/config/blacklist')
  }

  /** Add one company to the blacklist. */
  addBlacklist(value: string, type: 'company' | 'recruiter' | 'job' = 'company'): Promise<unknown> {
    return this.call('POST', '/api/boss/config/blacklist', { value, type })
  }

  /** Remove one blacklist entry by id. */
  removeBlacklist(id: number): Promise<boolean> {
    return this.call<boolean>('DELETE', `/api/boss/config/blacklist/${id}`)
  }

  /**
   * AI profile (introduce + prompt template).
   *
   * `AiConfigController` wraps the entity in `{success, data, message}` — the
   * old version read `raw` directly and got `undefined` for every field, which
   * is why the settings page and resume page both showed empty introduce/prompt
   * even when the table had real values. Unwrap `data` first; fall back to `raw`
   * for callers that return the entity bare (tests, older endpoints).
   */
  async aiProfile(): Promise<{ id?: number; introduce?: string; prompt?: string }> {
    const raw = await this.call<Record<string, unknown>>('GET', '/api/ai/config')
    const data = (raw['data'] as Record<string, unknown> | undefined) ?? raw
    const list = Array.isArray(data) ? data : [data]
    return (list[0] ?? {}) as { id?: number; introduce?: string; prompt?: string }
  }

  /** Persist the AI profile. */
  saveAiProfile(introduce: string, prompt: string): Promise<unknown> {
    return this.call('POST', '/api/ai/config', { introduce, prompt })
  }

  /**
   * Raw app config (BASE_URL / API_KEY / MODEL / HOOK_URL / …).
   *
   * The backend's `GET /api/config` is the same endpoint the original admin UI
   * used — it returns plaintext values. That's acceptable here: the backend
   * binds to loopback and this panel runs on the same machine, same user.
   */
  async appConfig(): Promise<Record<string, string>> {
    const raw = await this.call<Record<string, unknown>>('GET', '/api/config')
    const data = (raw['data'] as Record<string, unknown>) ?? raw
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) {
      result[key] = value == null ? '' : String(value)
    }
    return result
  }

  /** Batch-upsert config keys (missing keys are created automatically). */
  saveAppConfig(patch: Record<string, string>): Promise<unknown> {
    return this.call('POST', '/api/config', patch)
  }

  /** Delete one user-added config key (core keys are rejected server-side). */
  deleteAppConfig(key: string): Promise<unknown> {
    return this.call('DELETE', `/api/config/${encodeURIComponent(key)}`)
  }

  /**
   * Ask the configured LLM to polish a piece of text.
   *
   * Uses `GET /api/ai/chat?content=…` (AiConfigController). The reply comes
   * back wrapped in `{success, data, message}` — `data` is the model's text.
   */
  async aiPolish(text: string): Promise<string> {
    const instruction = '请润色以下求职招呼语，使其更简洁、专业、有吸引力，40字以内，不要出现公司名和岗位名，只输出润色后的文本，不要任何解释：\n\n' + text
    const raw = await this.call<Record<string, unknown>>('GET', `/api/ai/chat?content=${encodeURIComponent(instruction)}`)
    const data = raw['data'] ?? raw
    return typeof data === 'string' ? data : String(data ?? '')
  }

  /**
   * AI usage and budget limits (`GET /api/ai/usage`).
   *
   * `today` is persisted per day in SQLite, `run` is in-memory and resets when a
   * delivery starts. Powers the "AI 用量" card in Settings.
   */
  async aiUsage(): Promise<AiUsage> {
    const raw = await this.call<Record<string, unknown>>('GET', '/api/ai/usage')
    return (raw['data'] as AiUsage | undefined) ?? (raw as unknown as AiUsage)
  }

  /**
   * 今日投递进度与每日目标（`GET /api/delivery/quota`）。
   *
   * 后端每成功投出一份就 +1，所以这个数字和配额闸门用的是同一份数据。
   */
  async deliveryQuota(): Promise<DeliveryQuota> {
    const raw = await this.call<Record<string, unknown>>('GET', '/api/delivery/quota')
    return (raw['data'] as DeliveryQuota | undefined) ?? (raw as unknown as DeliveryQuota)
  }

  /** 清零今天的投递计数（目标配置保留）。 */
  resetDeliveryQuota(): Promise<unknown> {
    return this.call('POST', '/api/delivery/quota/reset')
  }

  /**
   * Ask the model to score a resume (`POST /api/resume/evaluate`, multipart).
   *
   * Kept separate from {@link JobsApi.uploadResumeImage}: that one stores an
   * image for Boss, this one only reads the file, extracts text and returns a
   * structured evaluation. Nothing is persisted server-side.
   */
  async evaluateResume(file: File): Promise<{ evaluation: ResumeEvaluation; meta?: Record<string, unknown> }> {
    const body = new FormData()
    body.append('file', file)
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/resume/evaluate`, { method: 'POST', body })
    } catch {
      throw new ApiError('无法连接后端', '后端进程可能未启动')
    }
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = text
    }
    if (!response.ok) {
      const record = (parsed ?? {}) as Record<string, unknown>
      const message = typeof record['message'] === 'string' ? record['message'] : ''
      throw new ApiError(message || `评估失败（${response.status}）`)
    }
    return parsed as { evaluation: ResumeEvaluation; meta?: Record<string, unknown> }
  }

  /**
   * Render a resume into a long image and save it as the Boss resume image
   * (`POST /api/resume/image`, multipart).
   *
   * One call does both: the backend lays the extracted text out with Java2D and
   * writes the result into the same storage the manual upload uses, so an
   * enabled `发送图片简历` will send this image without a second upload.
   */
  async generateResumeImage(file: File): Promise<ResumeImageResult> {
    const body = new FormData()
    body.append('file', file)
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/resume/image`, { method: 'POST', body })
    } catch {
      throw new ApiError('无法连接后端', '后端进程可能未启动')
    }
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = text
    }
    if (!response.ok) {
      const record = (parsed ?? {}) as Record<string, unknown>
      const message = typeof record['message'] === 'string' ? record['message'] : ''
      throw new ApiError(message || `生成长图失败（${response.status}）`)
    }
    return parsed as ResumeImageResult
  }

  /** Upload or replace the Boss resume image (multipart, field name `file`). */
  async uploadResumeImage(file: File): Promise<ResumeImageMeta> {
    const body = new FormData()
    body.append('file', file)
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/boss/config/resume-image`, { method: 'POST', body })
    } catch {
      throw new ApiError('无法连接后端', '后端进程可能未启动')
    }
    const payload = await response.json() as { success?: boolean; message?: string; resumeImage?: ResumeImageMeta }
    if (!response.ok || !payload.success) {
      throw new ApiError(payload.message ?? `上传失败（${response.status}）`)
    }
    return payload.resumeImage ?? { exists: false }
  }

  /** URL for the resume image binary (use as `<img src>`); 404 when none uploaded. */
  resumeImageContentUrl(): string {
    return `${this.baseUrl}/api/boss/config/resume-image/content`
  }

  /** Download URL for the job export. */
  exportUrl(query: Record<string, string | number> = {}): string {
    const suffix = Object.entries(query)
      .filter(([, value]) => value !== '' && value !== undefined)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')
    return `${this.baseUrl}/api/export/jobs${suffix ? `?${suffix}` : ''}`
  }
}

/** Pixel-accurate "n minutes ago" used by the run log. */
export function timeLabel(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return date.toLocaleDateString('zh-CN')
}
