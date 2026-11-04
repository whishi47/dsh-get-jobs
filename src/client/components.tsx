/**
 * Primitive UI components. Inline-styled on purpose: the client bundle loads
 * inside the host renderer where no external stylesheet is guaranteed.
 * @module dsh-get-jobs/client/components
 */
import React from 'react'

import { tokens } from './theme.js'

/** Mono-line icon set; no emoji anywhere in this plugin. */
export type IconName = 'play' | 'stop' | 'refresh' | 'export' | 'upload' | 'check' | 'alert' | 'clock' | 'list' | 'sliders'

const PATHS: Record<IconName, string> = {
  play: 'M8 5v14l11-7z',
  stop: 'M7 7h10v10H7z',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
  export: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
  upload: 'M12 21V9m0 0l-4 4m4-4l4 4M4 5h16',
  check: 'M4 12l5 5L20 6',
  alert: 'M12 8v5m0 3h.01M10.3 3.9L2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
}

/** Render one icon at `size` px, inheriting the current text color. */
export function Icon({ name, size = 14 }: { name: IconName; size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'play' || name === 'stop' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={name === 'play' || name === 'stop' ? 0 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: '0 0 auto' }}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

type ButtonTone = 'default' | 'primary' | 'danger' | 'ghost'

/** Compact button; `primary` is the only place the accent color appears. */
export function Button({
  children,
  onClick,
  tone = 'default',
  disabled,
  icon,
  title,
  type = 'button',
}: {
  children?: React.ReactNode
  onClick?: () => void
  tone?: ButtonTone
  disabled?: boolean
  icon?: IconName
  title?: string
  type?: 'button' | 'submit'
}): React.ReactElement {
  const palette: Record<ButtonTone, React.CSSProperties> = {
    default: { background: tokens.color.surface, border: `1px solid ${tokens.color.border}`, color: tokens.color.text },
    primary: { background: tokens.color.accent, border: '1px solid transparent', color: '#ffffff' },
    danger: { background: 'transparent', border: `1px solid ${tokens.color.danger}`, color: tokens.color.danger },
    ghost: { background: 'transparent', border: '1px solid transparent', color: tokens.color.textMuted },
  }
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        fontSize: tokens.font.sm,
        borderRadius: tokens.radius.md,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...palette[tone],
      }}
    >
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </button>
  )
}

/** Status pill with a soft background; `tone` decides color only. */
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'
}): React.ReactElement {
  const map = {
    neutral: [tokens.color.surfaceAlt, tokens.color.textMuted],
    success: [tokens.color.successSoft, tokens.color.success],
    warning: [tokens.color.warningSoft, tokens.color.warning],
    danger: [tokens.color.dangerSoft, tokens.color.danger],
    accent: [tokens.color.accentSoft, tokens.color.accent],
  } as const
  const [bg, fg] = map[tone]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '1px 8px',
      borderRadius: tokens.radius.pill,
      background: bg,
      color: fg,
      fontSize: tokens.font.xs,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

/** Bordered surface used for every content block. */
export function Card({
  children,
  title,
  actions,
  compact,
}: {
  children: React.ReactNode
  title?: string
  actions?: React.ReactNode
  compact?: boolean
}): React.ReactElement {
  return (
    <section style={{
      background: tokens.color.bg,
      border: `1px solid ${tokens.color.border}`,
      borderRadius: tokens.radius.lg,
      boxShadow: tokens.shadow,
      // overflow:hidden + flex item = 自动最小尺寸按 0 算（CSS 规范），
      // 页面高度不够时卡片会被无限压缩、内容被自己裁掉且页面永不滚动。
      // Card 必须保持自然高度，溢出交给外层 pageStyle 滚动
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {title || actions ? (
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space(3),
          padding: compact ? '8px 12px' : '10px 14px',
          borderBottom: `1px solid ${tokens.color.border}`,
          background: tokens.color.surface,
        }}>
          <span style={{ fontSize: tokens.font.sm, fontWeight: 600 }}>{title}</span>
          <div style={{ display: 'flex', gap: 6 }}>{actions}</div>
        </header>
      ) : null}
      <div style={{ padding: compact ? 12 : 14 }}>{children}</div>
    </section>
  )
}

/** Label + control row used by every form. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: tokens.font.sm, color: tokens.color.textMuted }}>{label}</span>
      {children}
      {hint ? <span style={{ fontSize: tokens.font.xs, color: tokens.color.textFaint }}>{hint}</span> : null}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 9px',
  fontSize: tokens.font.md,
  color: tokens.color.text,
  background: tokens.color.bg,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.md,
  outline: 'none',
}

/** Single-line text input. */
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return <input {...props} style={{ ...inputStyle, ...props.style }} />
}

/** Multi-line text input. */
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactElement {
  return <textarea {...props} style={{ ...inputStyle, minHeight: 80, resize: 'vertical', ...props.style }} />
}

/** Switch rendering as a 32×18 track; no library. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
}): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 32,
        height: 18,
        borderRadius: tokens.radius.pill,
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        background: checked ? tokens.color.accent : tokens.color.surfaceAlt,
        position: 'relative',
        transition: 'background 120ms',
        flex: '0 0 auto',
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2,
        left: checked ? 16 : 2,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#ffffff',
        transition: 'left 120ms',
      }} />
    </button>
  )
}

/** Horizontal tab strip. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ value: T; label: string; badge?: React.ReactNode }>
  value: T
  onChange: (next: T) => void
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${tokens.color.border}` }}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              fontSize: tokens.font.md,
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${active ? tokens.color.accent : 'transparent'}`,
              color: active ? tokens.color.text : tokens.color.textMuted,
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {item.label}
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}

/** Table with a sticky header; cells are pre-formatted strings by design. */
export function Table({
  headers,
  rows,
  empty,
  maxHeight,
}: {
  headers: string[]
  rows: React.ReactNode[][]
  empty?: React.ReactNode
  maxHeight?: number
}): React.ReactElement {
  if (rows.length === 0) {
    return <div style={{ padding: 24 }}>{empty ?? <Empty title="没有数据" />}</div>
  }
  return (
    <div style={{ overflow: 'auto', maxHeight }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: tokens.font.sm }}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} style={{
                textAlign: 'left',
                padding: '7px 10px',
                fontWeight: 600,
                color: tokens.color.textMuted,
                background: tokens.color.surface,
                borderBottom: `1px solid ${tokens.color.border}`,
                position: 'sticky',
                top: 0,
                whiteSpace: 'nowrap',
              }}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} style={{ borderBottom: `1px solid ${tokens.color.border}` }}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{ padding: '6px 10px', verticalAlign: 'top' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Empty state: one sentence plus an optional next action. */
export function Empty({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
      padding: '28px 16px',
      textAlign: 'center',
      color: tokens.color.textMuted,
    }}>
      <div style={{ fontSize: tokens.font.md, color: tokens.color.text }}>{title}</div>
      {hint ? <div style={{ fontSize: tokens.font.sm, maxWidth: 420 }}>{hint}</div> : null}
      {action}
    </div>
  )
}

/** Loading placeholder; keeps layout height stable while data arrives. */
export function Skeleton({ height = 14, width = '100%' }: { height?: number; width?: number | string }): React.ReactElement {
  return (
    <div style={{
      height,
      width,
      borderRadius: tokens.radius.sm,
      background: `linear-gradient(90deg, ${tokens.color.surfaceAlt}, ${tokens.color.surface}, ${tokens.color.surfaceAlt})`,
      backgroundSize: '200% 100%',
      animation: 'gj-shimmer 1.4s ease-in-out infinite',
    }} />
  )
}

/** Error state with the reason and a retry affordance. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 16,
      borderRadius: tokens.radius.md,
      border: `1px solid ${tokens.color.danger}`,
      background: tokens.color.dangerSoft,
      color: tokens.color.text,
      fontSize: tokens.font.sm,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: tokens.color.danger }}>
        <Icon name="alert" /> 出错了
      </div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{message}</div>
      {onRetry ? <div><Button onClick={onRetry} icon="refresh">重试</Button></div> : null}
    </div>
  )
}

/** Toast stack, bottom-right, auto dismiss. */
export function ToastHost({ toasts }: { toasts: Array<{ id: number; text: string; tone: 'info' | 'error' }> }): React.ReactElement {
  return (
    <div style={{ position: 'absolute', right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 10 }}>
      {toasts.map((toast) => (
        <div key={toast.id} style={{
          padding: '8px 12px',
          borderRadius: tokens.radius.md,
          fontSize: tokens.font.sm,
          background: toast.tone === 'error' ? tokens.color.danger : tokens.color.text,
          color: '#ffffff',
          boxShadow: '0 4px 12px rgba(16,24,40,0.18)',
          maxWidth: 360,
        }}>{toast.text}</div>
      ))}
    </div>
  )
}

/** Key/value grid used by overview and diagnostics. */
export function KeyValue({ items }: { items: Array<[string, React.ReactNode]> }): React.ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: tokens.font.sm }}>
      {items.map(([key, value]) => (
        <React.Fragment key={key}>
          <span style={{ color: tokens.color.textMuted }}>{key}</span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

/** Inline horizontal bar chart; no chart library. */
export function BarList({
  items,
  max,
}: {
  items: Array<{ label: string; value: number }>
  max?: number
}): React.ReactElement {
  const peak = max ?? Math.max(1, ...items.map((item) => item.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 48px', alignItems: 'center', gap: 8, fontSize: tokens.font.sm }}>
          <span style={{ color: tokens.color.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
          <span style={{ height: 6, borderRadius: tokens.radius.pill, background: tokens.color.surfaceAlt, overflow: 'hidden' }}>
            <span style={{
              display: 'block',
              height: '100%',
              width: `${Math.round((item.value / peak) * 100)}%`,
              background: tokens.color.accent,
              opacity: 0.75,
            }} />
          </span>
          <span style={{ textAlign: 'right', color: tokens.color.text }}>{item.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Spacer that pushes siblings apart inside a flex row. */
export function Spacer(): React.ReactElement {
  return <span style={{ flex: 1 }} />
}

/**
 * Sidebar launcher icon: a briefcase, stroke-based, inherits text color.
 *
 * Lives here rather than in the entry module so `src/client/index.ts` can stay
 * plain TypeScript — the slot contract expects an `index.ts` entry.
 */
export function SidebarLauncherIcon({ size = 18, active }: { size?: number; active?: boolean }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ opacity: active ? 1 : 0.75 }}
    >
      <rect x="2.5" y="7" width="19" height="13" rx="2.5" />
      <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M2.5 12.5h19" />
      <path d="M10 12.5v2h4v-2" />
    </svg>
  )
}

/**
 * Picker for code-valued fields.
 *
 * The backend stores things like `cityCode` / `salary` / `degree` as numeric
 * codes (`101280100`, `405`, `203`). A plain text box makes those fields
 * impossible to fill, so they get a searchable chip picker instead.
 */
export function CodePicker({
  value,
  options,
  multiple = true,
  placeholder = '输入关键字搜索',
  onChange,
}: {
  value: string[]
  options: Array<{ name: string; code: string }>
  multiple?: boolean
  placeholder?: string
  onChange: (next: string[]) => void
}): React.ReactElement {
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const selected = new Set(value)

  const nameOf = (code: string): string =>
    options.find((item) => item.code === code)?.name ?? code

  const matches = options
    .filter((item) => !selected.has(item.code))
    .filter((item) => {
      const needle = query.trim().toLowerCase()
      if (!needle) return true
      return item.name.toLowerCase().includes(needle) || item.code.includes(needle)
    })
    .slice(0, 60)

  function pick(code: string): void {
    onChange(multiple ? [...value, code] : [code])
    setQuery('')
    if (!multiple) setOpen(false)
  }

  return (
    <div
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
      }}
      style={{ position: 'relative' }}
    >
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        minHeight: 32,
        borderRadius: tokens.radius.md,
        border: `1px solid ${tokens.color.border}`,
        background: tokens.color.bg,
      }}>
        {value.map((code) => (
          <span key={code} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            borderRadius: tokens.radius.sm,
            background: tokens.color.accentSoft,
            color: tokens.color.accent,
            fontSize: tokens.font.sm,
            maxWidth: 220,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(code)}</span>
            <button
              type="button"
              aria-label={`移除 ${nameOf(code)}`}
              onClick={() => onChange(value.filter((item) => item !== code))}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
                fontSize: 13,
              }}
            >×</button>
          </span>
        ))}
        <input
          value={query}
          placeholder={value.length === 0 ? placeholder : ''}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && query === '' && value.length > 0) {
              onChange(value.slice(0, -1))
            }
            if (event.key === 'Enter' && matches[0]) {
              event.preventDefault()
              pick(matches[0].code)
            }
          }}
          style={{
            flex: 1,
            minWidth: 90,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: tokens.color.text,
            fontSize: tokens.font.md,
            padding: '2px 0',
          }}
        />
      </div>

      {open && matches.length > 0 ? (
        <div style={{
          position: 'absolute',
          zIndex: 20,
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          maxHeight: 240,
          overflow: 'auto',
          borderRadius: tokens.radius.md,
          border: `1px solid ${tokens.color.border}`,
          background: tokens.color.bg,
          boxShadow: '0 6px 20px rgba(0,0,0,0.10)',
          padding: 4,
        }}>
          {matches.map((item) => (
            <button
              key={item.code}
              type="button"
              onMouseDown={(event) => { event.preventDefault(); pick(item.code) }}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                width: '100%',
                padding: '5px 8px',
                border: 'none',
                borderRadius: tokens.radius.sm,
                background: 'transparent',
                color: tokens.color.text,
                fontSize: tokens.font.sm,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
              <span style={{ color: tokens.color.textFaint, flexShrink: 0 }}>{item.code}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
