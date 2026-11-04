/**
 * dsh-get-jobs — 求职投递自动化插件 for DeepSeek Harness.
 *
 * Node half: own the backend lifecycle (probe → start → stop), expose the
 * status route the panel reads, and give the agent two tools to do the same
 * thing from chat.
 * @module dsh-get-jobs
 */
import type { Context } from '@deepseek-ai/cordis'
// Loads the `ctx.webServer` augmentation without a runtime import.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { GetJobsClient } from './api/client.js'
import { BackendSupervisor } from './backend/supervisor.js'
import { Config, resolveConfig, type Config as ConfigShape } from './config.js'

/** Plugin id used by the patch row, the client bundle, and the health route. */
export const name = 'dsh-get-jobs'

/** Tools plus the loopback server the panel reads status from. */
export const inject = ['tools', 'webServer']

/** Route the browser half polls for backend state. */
export const HEALTH_PATH = '/dsh-get-jobs/health'

/**
 * One supervisor per base URL.
 *
 * If the host ever loads this plugin twice (bundle row plus a manual patch row),
 * two supervisors would each spawn a JVM and fight over port 9527 — the second
 * one dies with "port already in use" and the panel shows a restart loop. Sharing
 * the instance makes that impossible, and it costs nothing in the normal case.
 */
const supervisors = new Map<string, BackendSupervisor>()

function supervisorFor(config: ReturnType<typeof resolveConfig>): BackendSupervisor {
  const key = `${config.baseUrl}|${config.projectDir ?? ''}`
  const existing = supervisors.get(key)
  if (existing) return existing
  const created = new BackendSupervisor(config)
  supervisors.set(key, created)
  return created
}

export { Config }

/**
 * Register the toolset, expose the status route, and (optionally) bring the
 * backend up as soon as the plugin mounts.
 */
export function apply(ctx: Context, config: ConfigShape = {}): void {
  const resolved = resolveConfig(config)
  const client = new GetJobsClient(resolved)
  const supervisor = supervisorFor(resolved)

  const statusTool = defineTool({
    name: 'getjobs_status',
    description: '查看后端状态：是否在线、是否由插件托管、JDK 与日志位置。回答"后端起来了吗"用它。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', required: true },
          reachable: { type: 'boolean', required: true },
          managed: { type: 'boolean', required: true },
          pid: { type: 'integer' },
          logPath: { type: 'string' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `后端状态：${value.state}（${value.reachable ? '在线' : '不可达'}）`,
          value.pid ? `进程：${value.pid}（插件托管）` : '进程：未托管',
          value.logPath ? `日志：${value.logPath}` : '',
          value.message,
        ].filter(Boolean).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute() {
      const reachable = await supervisor.probe()
      const status = supervisor.status()
      return {
        state: reachable ? 'ready' : status.state,
        reachable,
        managed: status.managed,
        pid: status.pid,
        logPath: status.logPath,
        message: reachable ? '后端在线' : status.message,
      }
    },
  })

  const backendTool = defineTool({
    name: 'getjobs_backend',
    description: '启动或停止本机后端。start 会优先用已构建的 jar 直启，缺失时回退 gradlew bootRun，并等到健康检查通过。',
    parameters: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'status'],
        required: true,
        description: 'start 启动并等待就绪，stop 停止插件托管的进程，status 仅查看',
      },
      waitMs: { type: 'integer', description: '启动等待上限，默认 90000 毫秒' },
      confirm: {
        type: 'boolean',
        description: 'mutations=confirm 时必须显式传 true 才会真正启停；status 不需要',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          state: { type: 'string', required: true },
          reachable: { type: 'boolean', required: true },
          managed: { type: 'boolean', required: true },
          pid: { type: 'integer' },
          logPath: { type: 'string' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `${value.action}：${value.state}（${value.reachable ? '在线' : '不可达'}）`,
          value.pid ? `进程 ${value.pid}` : '',
          value.message,
        ].filter(Boolean).join('\n'),
      }],
    },
    async execute(args) {
      if (args.action === 'status') {
        const reachable = await supervisor.probe()
        const status = supervisor.status()
        return { action: 'status', state: reachable ? 'ready' : status.state, reachable, managed: status.managed, pid: status.pid, logPath: status.logPath, message: status.message }
      }
      // 写操作闸门：deny 直接拒绝，confirm 要求显式确认，allow 放行
      if (resolved.mutations === 'deny') {
        return {
          action: args.action,
          state: 'denied',
          reachable: false,
          managed: false,
          message: '插件配置 mutations=deny，启停后端已被禁用。改配置后重启 DSH 生效。',
        }
      }
      if (resolved.mutations === 'confirm' && args.confirm !== true) {
        return {
          action: args.action,
          state: 'needs-confirmation',
          reachable: false,
          managed: supervisor.status().managed,
          message: `即将${args.action === 'start' ? '启动' : '停止'}后端进程（会占用或释放 9527 端口）。确认后带 confirm: true 重新调用。`,
        }
      }

      if (args.action === 'stop') {
        const status = supervisor.stop()
        return { action: 'stop', state: status.state, reachable: false, managed: status.managed, logPath: status.logPath, message: status.message }
      }
      const result = await supervisor.ensureRunning(Math.min(300000, Math.max(5000, args.waitMs ?? 90000)))
      return {
        action: 'start',
        state: result.state,
        reachable: result.reachable,
        managed: result.managed,
        pid: result.pid,
        logPath: result.logPath,
        message: result.message + (result.reachable ? '' : `\n${supervisor.logTail(20)}`),
      }
    },
  })

  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(statusTool),
      ctx.tools.register(backendTool),
      ctx.webServer.register({
        kind: 'exact',
        path: HEALTH_PATH,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('method not allowed')
            return
          }
          const reachable = await supervisor.probe(1500)
          const status = supervisor.status()
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify({
            plugin: name,
            baseUrl: client.baseUrl,
            reachable,
            state: reachable ? 'ready' : status.state,
            managed: status.managed,
            pid: status.pid,
            message: reachable ? '后端在线' : status.message,
          }))
        },
      }),
    ]

    // Bring the backend up without blocking activation; the panel polls the route.
    if (resolved.autostart) {
      void supervisor.ensureRunning().catch(() => undefined)
    }

    return () => {
      for (const dispose of disposers) dispose()
      supervisor.dispose()
      supervisors.delete(`${resolved.baseUrl}|${resolved.projectDir ?? ''}`)
    }
  })
}
