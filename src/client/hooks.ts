/**
 * Minimal data-fetching hooks. No external state library: the panel owns six
 * pages and a handful of resources, so three small hooks cover every case.
 * @module dsh-get-jobs/client/hooks
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fetchHealth, JobsApi, type HealthPayload } from './api.js'

/** Result shape shared by every resource hook. */
export interface Resource<T> {
  data: T | undefined
  error: string | undefined
  loading: boolean
  reload: () => void
}

/**
 * Run an async fetcher whenever `deps` change, exposing loading/error/retry.
 * Stale responses are dropped so late replies cannot overwrite fresh state.
 */
export function useResource<T>(fetcher: () => Promise<T>, deps: unknown[]): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    setLoading(true)
    setError(undefined)
    fetcher()
      .then((value) => {
        if (current === generation.current) {
          setData(value)
          setLoading(false)
        }
      })
      .catch((caught: unknown) => {
        if (current === generation.current) {
          setError(caught instanceof Error ? caught.message : String(caught))
          setLoading(false)
        }
      })
    return () => {
      generation.current += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { data, error, loading, reload }
}

/**
 * Plugin health plus a ready-to-use backend client.
 *
 * Health **polls**, it does not fetch once. The backend needs ~10-40 s to come
 * up (Spring + Playwright + platform cookie refresh), so a single fetch at mount
 * would leave the panel stuck on "后端未启动" forever — which is exactly what
 * happened the first time this plugin ran for real.
 *
 * Cadence: fast while starting (1.5 s), slower when healthy (20 s, enough to
 * notice a crash), moderate when failed (5 s, so the supervisor's own retry
 * becomes visible without hammering).
 */
export function useBackend(): {
  health: HealthPayload | undefined
  api: JobsApi | undefined
  error: string | undefined
  loading: boolean
  /** Bumps every time the backend transitions to reachable; use it as a dep. */
  revision: number
  reload: () => void
} {
  const [health, setHealth] = useState<HealthPayload | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [tick, setTick] = useState(0)
  const wasReachable = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const loop = async (): Promise<void> => {
      try {
        const next = await fetchHealth()
        if (cancelled) return
        setHealth(next)
        setError(undefined)
        setLoading(false)
        if (next.reachable && !wasReachable.current) setRevision((value) => value + 1)
        wasReachable.current = next.reachable
        const starting = next.state === 'starting' || next.state === 'probing'
        timer = setTimeout(() => { void loop() }, next.reachable ? 20_000 : starting ? 1_500 : 5_000)
      } catch (caught) {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : String(caught))
        setLoading(false)
        timer = setTimeout(() => { void loop() }, 5_000)
      }
    }

    void loop()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [tick])

  const baseUrl = health?.baseUrl
  const api = useMemo(() => (baseUrl ? new JobsApi(baseUrl) : undefined), [baseUrl])

  const reload = useCallback(() => setTick((value) => value + 1), [])
  return { health, api, error, loading, revision, reload }
}

/** Toast queue with auto-dismiss. */
export function useToasts(): {
  toasts: Array<{ id: number; text: string; tone: 'info' | 'error' }>
  push: (text: string, tone?: 'info' | 'error') => void
} {
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; tone: 'info' | 'error' }>>([])
  const nextId = useRef(1)

  const push = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    const id = nextId.current++
    setToasts((list) => [...list, { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 3200)
  }, [])

  return { toasts, push }
}

/** Poll a callback on an interval while `active` is true. */
export function usePolling(callback: () => void, intervalMs: number, active: boolean): void {
  const saved = useRef(callback)
  saved.current = callback
  useEffect(() => {
    if (!active) return
    const handle = setInterval(() => saved.current(), intervalMs)
    return () => clearInterval(handle)
  }, [intervalMs, active])
}
