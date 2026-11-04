/**
 * Plugin configuration: where the backend checkout lives and how the backend
 * is started. Every value is optional — the defaults are derived from the
 * plugin's own location.
 * @module dsh-get-jobs/config
 */
import { defaultDataDir, DEFAULT_DB_URL, DEFAULT_JAR_URL } from './backend/provision.js'
import Schema from '@deepseek-ai/schemastery'

/** Write policy for mutating tools. */
export type MutationPolicy = 'confirm' | 'allow' | 'deny'

/** Configuration accepted by the plugin row. */
export interface Config {
  /** Base URL of the backend. */
  baseUrl?: string
  /** Backend checkout; defaults to the parent of the plugin directory. */
  projectDir?: string
  /** `JAVA_HOME` used to launch the backend (JDK 21 required). */
  javaHome?: string
  /** Explicit jar path; defaults to the newest `build/libs/*.jar`. */
  jarPath?: string
  /** Jar download URL for machines without a backend checkout; downloaded once into `dataDir`. */
  jarUrl?: string
  /** SQLite template URL; provisions `db/getjobs.db` in the working directory. */
  dbUrl?: string
  /** Where downloaded jar/db live; defaults to `<DSH_HOME|~>/.dsh/get-jobs`. */
  dataDir?: string
  /** Start the backend automatically when the panel mounts. */
  autostart?: boolean
  /** Per-request HTTP timeout in milliseconds. */
  timeoutMs?: number
  /** Whether mutating tools run freely, require `confirm: true`, or are refused. */
  mutations?: MutationPolicy
}

/** Runtime configuration schema. */
export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:9527').description('后端地址'),
  projectDir: Schema.string().description('后端仓库目录，默认向上自动发现；公开安装模式无需配置'),
  javaHome: Schema.string().description('启动后端使用的 JAVA_HOME（需 JDK 21）'),
  jarPath: Schema.string().description('显式指定可执行 jar；默认自动挑选 build/libs 下最新的'),
  jarUrl: Schema.string().description('后端 jar 下载地址（公开安装模式）：默认从 GitHub Release 拉取 backend.jar；无本地 jar 时首次启动自动下载到 dataDir'),
  dbUrl: Schema.string().description('SQLite 模板库下载地址：工作目录缺 db/getjobs.db 时自动下载'),
  dataDir: Schema.string().description('下载产物（jar/db）存放目录，默认 <DSH_HOME|~>/.dsh/get-jobs'),
  autostart: Schema.boolean().default(true).description('面板打开时自动拉起后端'),
  timeoutMs: Schema.number().default(15000).description('单次 HTTP 超时（毫秒）'),
  mutations: Schema.union(['confirm', 'allow', 'deny'] as const)
    .default('confirm')
    .description('写操作策略'),
})

/** Configuration with every field resolved. */
export interface ResolvedConfig {
  baseUrl: string
  projectDir: string | undefined
  javaHome: string | undefined
  jarPath: string | undefined
  jarUrl: string | undefined
  dbUrl: string | undefined
  dataDir: string
  autostart: boolean
  timeoutMs: number
  mutations: MutationPolicy
}

/** Resolve defaults without hiding them inside individual call sites. */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const rawBase = (config.baseUrl ?? 'http://127.0.0.1:9527').trim()
  return {
    baseUrl: rawBase.replace(/\/+$/, ''),
    projectDir: config.projectDir?.trim() || undefined,
    javaHome: config.javaHome?.trim() || undefined,
    jarPath: config.jarPath?.trim() || undefined,
    jarUrl: config.jarUrl?.trim() || DEFAULT_JAR_URL,
    dbUrl: config.dbUrl?.trim() || DEFAULT_DB_URL,
    dataDir: config.dataDir?.trim() || defaultDataDir(),
    autostart: config.autostart !== false,
    timeoutMs: Number.isFinite(config.timeoutMs) && (config.timeoutMs ?? 0) > 0 ? Number(config.timeoutMs) : 15000,
    mutations: config.mutations ?? 'confirm',
  }
}
