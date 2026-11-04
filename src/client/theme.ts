/**
 * Design tokens. Deliberately narrow: one accent, four semantic colors, no
 * gradients, no shadows beyond a hairline. Components must never hardcode a
 * color — everything comes from here so dark mode is a single override.
 * @module dsh-get-jobs/client/theme
 */
import type { CSSProperties } from 'react'

export const tokens = {
  color: {
    bg: 'var(--gj-bg, #ffffff)',
    surface: 'var(--gj-surface, #f6f7f9)',
    surfaceAlt: 'var(--gj-surface-alt, #eef0f3)',
    border: 'var(--gj-border, rgba(16,24,40,0.10))',
    borderStrong: 'var(--gj-border-strong, rgba(16,24,40,0.18))',
    text: 'var(--gj-text, #101828)',
    textMuted: 'var(--gj-text-muted, #667085)',
    textFaint: 'var(--gj-text-faint, #98a2b3)',
    accent: '#2f6feb',
    accentSoft: 'rgba(47,111,235,0.10)',
    success: '#2e7d5b',
    successSoft: 'rgba(46,125,91,0.12)',
    warning: '#b4801f',
    warningSoft: 'rgba(180,128,31,0.14)',
    danger: '#b3453a',
    dangerSoft: 'rgba(179,69,58,0.12)',
  },
  radius: { sm: 4, md: 6, lg: 10, pill: 999 },
  font: { xs: 11, sm: 12, md: 13, lg: 15, xl: 18 },
  space: (n: number) => n * 4,
  shadow: '0 1px 2px rgba(16,24,40,0.06)',
} as const

/** Shared page padding used by every page to keep rhythms identical. */
export const pageStyle: CSSProperties = {
  padding: `${tokens.space(4)}px ${tokens.space(5)}px`,
  display: 'flex',
  flexDirection: 'column',
  gap: tokens.space(4),
  // flex:1 1 auto + minHeight:0 让页面在 App 的列式 flex 容器里被约束到面板实际
  // 高度（App 根节点已按宿主 centerCol 的 flex item 拿到确定高度），溢出交给本
  // 容器滚动。链上任一节点丢了 minHeight:0，flex item 的 min-content 下限就会
  // 撑破父级、overflow:auto 失效
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'auto',
  color: tokens.color.text,
  fontSize: tokens.font.md,
  lineHeight: 1.55,
}

/** Panel header row: title on the left, actions on the right. */
export const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: tokens.space(3),
  minHeight: 28,
}

/** Section title. */
export const sectionTitleStyle: CSSProperties = {
  fontSize: tokens.font.sm,
  fontWeight: 600,
  color: tokens.color.textMuted,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
}
