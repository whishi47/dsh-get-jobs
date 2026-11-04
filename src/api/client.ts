/**
 * Typed HTTP client for the Get Jobs REST API. Errors carry an actionable
 * sentence so tool output tells the user what to do next.
 * @module dsh-get-jobs/api/client
 */
import type { ResolvedConfig } from '../config.js'

/** The backend could not be reached at all. */
export class BackendUnreachable extends Error {
  constructor(baseUrl: string, detail: string) {
    super(`无法连接后端（${baseUrl}）：${detail}。请先启动后端。`)
    this.name = 'BackendUnreachable'
  }
}

/** The backend answered with a non-2xx status. */
export class BackendHttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message)
    this.name = 'BackendHttpError'
  }
}

/** Query values accepted by {@link GetJobsClient.get}. */
export type QueryValue = string | number | boolean | Array<string | number> | null | undefined

function encodeQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      params.set(key, value.join(','))
    } else {
      params.set(key, String(value))
    }
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

function describe(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return '请求超时'
  }
  const cause = (error as { cause?: { code?: string; message?: string } }).cause
  if (cause?.code === 'ECONNREFUSED') return '连接被拒绝，后端进程未启动'
  return cause?.message ?? (error instanceof Error ? error.message : String(error))
}

/** One JSON-over-HTTP client bound to the resolved configuration. */
export class GetJobsClient {
  constructor(private readonly config: ResolvedConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl
  }

  /** Low-level request; callers usually use the helpers below. */
  async request<T>(
    method: string,
    path: string,
    options: { query?: Record<string, QueryValue>; body?: unknown; timeoutMs?: number } = {},
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}${encodeQuery(options.query)}`
    const headers: Record<string, string> = { accept: 'application/json' }
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? this.config.timeoutMs),
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }

    let response: Response
    try {
      response = await fetch(url, init)
    } catch (error) {
      throw new BackendUnreachable(this.config.baseUrl, describe(error))
    }

    const raw = await response.text()
    let parsed: unknown
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = raw
      }
    }

    if (!response.ok) {
      const record = (parsed ?? {}) as Record<string, unknown>
      const detail = typeof record['message'] === 'string' ? record['message'] : response.statusText
      throw new BackendHttpError(path, response.status, parsed, `${method} ${path} 返回 ${response.status}：${detail}`)
    }
    return parsed as T
  }

  get<T>(path: string, options: { query?: Record<string, QueryValue>; timeoutMs?: number } = {}): Promise<T> {
    return this.request<T>('GET', path, options)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body })
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body })
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }
}
