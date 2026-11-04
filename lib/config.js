/**
 * Plugin configuration: where the backend checkout lives and how the backend
 * is started. Every value is optional — the defaults are derived from the
 * plugin's own location.
 * @module dsh-get-jobs/config
 */
import { defaultDataDir, DEFAULT_DB_URL, DEFAULT_JAR_URL } from './backend/provision.js';
import Schema from '@deepseek-ai/schemastery';
/** Runtime configuration schema. */
export const Config = Schema.object({
    baseUrl: Schema.string().default('http://127.0.0.1:9527').description('后端地址'),
    projectDir: Schema.string().description('后端仓库目录，默认向上自动发现；公开安装模式无需配置'),
    javaHome: Schema.string().description('启动后端使用的 JAVA_HOME（需 JDK 21）'),
    jarPath: Schema.string().description('显式指定可执行 jar；默认自动挑选 build/libs 下最新的'),
    jarUrl: Schema.string().description('后端 jar 下载地址（公开安装模式）：默认从 GitHub Release 拉取 backend.jar；无本地 jar 时首次启动自动下载到 dataDir'),
    dbUrl: Schema.string().description('SQLite 模板库下载地址：工作目录缺 db/getjobs.db 时自动下载'),
    dataDir: Schema.string().description('下载产物（jar/db）存放目录，默认 <DSH_HOME|~>/.dsh/get-jobs'),
    autostart: Schema.boolean().default(true).description('面板打开时自动拉起后端'),
    timeoutMs: Schema.number().default(15000).description('单次 HTTP 超时（毫秒）'),
    mutations: Schema.union(['confirm', 'allow', 'deny'])
        .default('confirm')
        .description('写操作策略'),
});
/** Resolve defaults without hiding them inside individual call sites. */
export function resolveConfig(config = {}) {
    const rawBase = (config.baseUrl ?? 'http://127.0.0.1:9527').trim();
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
    };
}
