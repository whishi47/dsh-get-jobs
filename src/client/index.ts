/**
 * Browser half entry: register the panel and its sidebar launcher.
 *
 * Registration uses `slots.inject(slotName, factory)` — the same deferred
 * pattern as the official plugin-manager client. The host declares `main`
 * (layout bundle) and `sidebar.panellist` (sidebar bundle) inside its own
 * start effects, so an immediate `slots.register` at bundle-load time loses
 * the race and dies with "slot is not declared" (observed on the real `dsh
 * web` profile; the desktop only escaped it because desktop-next loads plugin
 * clients after the shell had fully mounted). `inject` parks the registration
 * until the slot is declared, on both hosts.
 *
 * Deliberately plain TypeScript (no JSX): the slot contract looks for
 * `src/client/index.ts`, and JSX lives in the sibling `.tsx` modules.
 * @module dsh-get-jobs/client
 */
import { SidebarLauncherIcon } from './components.js'
import { PanelRoot } from './App.js'

/** Strict-injected services: `slots` must be declared or the host refuses activation. */
export const inject: string[] = ['slots']

const PANEL_ID = 'dsh-get-jobs'

/** Warn-and-continue wrapper: a broken registration costs the panel, not the web boot. */
function safeInject(slots: any, slotName: string, options: Record<string, unknown>, component: unknown): void {
  try {
    slots.inject(slotName, () => slots.register(options, component))
  } catch (error) {
    console.warn(`[dsh-get-jobs] ${slotName} 注册失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Register the main panel and the sidebar row that opens it. */
export function apply(ctx: any): void {
  const slots = ctx?.slots
  if (!slots || typeof slots.inject !== 'function') {
    console.warn('[dsh-get-jobs] slots 服务不可用，面板未注册（宿主无 slots 时跳过）')
    return
  }
  safeInject(slots, 'main', { name: 'main', key: PANEL_ID }, PanelRoot)
  safeInject(slots, 'sidebar.panellist', {
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: '求职投递',
  }, SidebarLauncherIcon)
}
