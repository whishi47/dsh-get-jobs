/**
 * Panel shell: left rail, page switch, backend banner, and the error boundary
 * that keeps a page failure inside the panel instead of failing the web boot.
 * @module dsh-get-jobs/client/App
 */
import React, { useState } from 'react'

import { Badge, Icon, Spacer, ToastHost, type IconName } from './components.js'
import { useBackend, useToasts } from './hooks.js'
import { Data } from './pages/Data.js'
import { Overview } from './pages/Overview.js'
import { Platforms } from './pages/Platforms.js'
import { Resume } from './pages/Resume.js'
import { Run } from './pages/Run.js'
import { Settings } from './pages/Settings.js'
import { tokens } from './theme.js'

const PAGES: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'overview', label: '概览', icon: 'list' },
  { id: 'platforms', label: '投递配置', icon: 'sliders' },
  { id: 'run', label: '运行', icon: 'play' },
  { id: 'data', label: '数据', icon: 'export' },
  { id: 'resume', label: '简历', icon: 'upload' },
  { id: 'settings', label: '设置', icon: 'clock' },
]

/** Catch render/effect failures from a page and show them in place. */
class PageBoundary extends React.Component<
  { children: React.ReactNode; page: string; onReset: () => void },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, lineHeight: 1.7, fontSize: tokens.font.sm }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>「{this.props.page}」渲染出错</div>
          <div style={{ color: tokens.color.textMuted, marginBottom: 10 }}>{String(this.state.error.message)}</div>
          <button
            type="button"
            onClick={() => { this.setState({ error: null }); this.props.onReset() }}
            style={{
              padding: '5px 10px',
              fontSize: tokens.font.sm,
              borderRadius: tokens.radius.md,
              border: `1px solid ${tokens.color.border}`,
              background: tokens.color.surface,
              color: tokens.color.text,
              cursor: 'pointer',
            }}
          >切换到概览</button>
        </div>
      )
    }
    return this.props.children
  }
}

/** The panel root registered into the `main` slot. */
export function PanelRoot(): React.ReactElement {
  return (
    <PageBoundary page="面板" onReset={() => undefined}>
      <App />
    </PageBoundary>
  )
}

function App(): React.ReactElement {
  const [page, setPage] = useState('overview')
  const backend = useBackend()
  const { toasts } = useToasts()

  const content = (() => {
    switch (page) {
      case 'platforms': return <Platforms />
      case 'run': return <Run />
      case 'data': return <Data />
      case 'resume': return <Resume />
      case 'settings': return <Settings />
      default: return <Overview onNavigate={setPage} />
    }
  })()

  // 冷启动要 9-10 秒，这段时间不该显示成"出故障"
  const starting = backend.health?.state === 'starting' || backend.health?.state === 'probing'

  return (
    <div style={{
      // 宿主布局（dsh-client-ui-layout/renderer 实源码核实）：
      //   frame(position:relative, height:100%, overflow:hidden)
      //   └─ centerCol(display:flex; column; overflow:hidden, 无 position)
      //       └─ anchor[data-slot="main"]  style={display:"contents"}（不产生盒子）
      //           └─ 本节点
      // 因此本节点就是 centerCol 的直接 flex item：
      //   flex:1 1 auto + minHeight:0 → 精确拿到列高，内页 overflow:auto 生效。
      // 不要用 position:absolute + inset:0——最近的 positioned 祖先是 frame（含侧栏），
      // 面板会铺满整个窗口盖住侧边栏（第 7 轮"越改越乱"的根因）。
      // position:relative 只用于给 ToastHost 等内部 absolute 元素当锚点，不参与撑满。
      position: 'relative',
      display: 'flex',
      flex: '1 1 auto',
      minWidth: 0,
      minHeight: 0,
      overflow: 'hidden',
      color: tokens.color.text,
      background: tokens.color.bg,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    }}>
      <nav style={{
        width: 132,
        flex: '0 0 auto',
        borderRight: `1px solid ${tokens.color.border}`,
        background: tokens.color.surface,
        padding: '10px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        <div style={{ padding: '4px 8px 10px', fontSize: tokens.font.sm, fontWeight: 600 }}>求职投递</div>
        {PAGES.map((item) => {
          const active = item.id === page
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setPage(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 8px',
                borderRadius: tokens.radius.md,
                border: 'none',
                background: active ? tokens.color.accentSoft : 'transparent',
                color: active ? tokens.color.accent : tokens.color.textMuted,
                fontSize: tokens.font.sm,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <Icon name={item.icon} size={14} />
              {item.label}
            </button>
          )
        })}
        <Spacer />
        <div style={{ padding: '6px 8px', fontSize: tokens.font.xs, color: tokens.color.textFaint }}>
          dsh-get-jobs
        </div>
      </nav>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {backend.health && !backend.health.reachable ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 14px',
            borderBottom: `1px solid ${tokens.color.border}`,
            // 启动中用中性色，只有真的失败才用警告色——否则每次冷启动都像出事了
            background: starting ? tokens.color.surfaceAlt : tokens.color.warningSoft,
            fontSize: tokens.font.sm,
          }}>
            <Badge tone={starting ? 'neutral' : 'warning'}>{starting ? '正在启动' : '后端未启动'}</Badge>
            <span style={{ color: tokens.color.textMuted }}>
              {starting
                ? (backend.health.message || '正在拉起后端，首次约 10 秒…')
                : (backend.health.message || '正在自动拉起后端…')}
            </span>
            <Spacer />
            <button
              type="button"
              onClick={backend.reload}
              style={{
                border: 'none',
                background: 'transparent',
                color: tokens.color.accent,
                fontSize: tokens.font.sm,
                cursor: 'pointer',
              }}
            >重新检查</button>
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {content}
        </div>
      </div>

      <ToastHost toasts={toasts} />
    </div>
  )
}
