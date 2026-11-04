/** Where jar/db downloads land when no project checkout exists. */
export declare function defaultDataDir(): string;
/** 后端 jar 下载地址（公开安装模式）：默认从 GitHub Release 拉取 backend.jar。 */
export declare const DEFAULT_JAR_URL = "https://github.com/whishi47/dsh-get-jobs/releases/latest/download/backend.jar";
/** SQLite 模板库下载地址：默认从 GitHub Release 拉取 getjobs.db.template。 */
export declare const DEFAULT_DB_URL = "https://github.com/whishi47/dsh-get-jobs/releases/latest/download/getjobs.db.template";
/** Hard cap so a misconfigured URL cannot fill the disk. */
export declare const JAR_MAX_BYTES: number;
export declare const DB_MAX_BYTES: number;
/** Which launch strategy `planBackendLaunch` settled on. */
export type LaunchKind = 'jar' | 'gradle' | 'download' | 'error';
/** Decision input — everything the supervisor knows before spawning. */
export interface LaunchInput {
    /** Explicit `jarPath` config (absolute path), if any. */
    jarPath?: string;
    /** Jar found in the project's `build/libs`, if any. */
    projectJar?: string;
    /** `jarUrl` config, if any. */
    jarUrl?: string;
    /** Whether the project directory carries a gradle wrapper. */
    hasGradlew: boolean;
}
/** Decision output — what the supervisor should do next. */
export interface LaunchPlan {
    kind: LaunchKind;
    /** For `error`: the user-facing remedy list. */
    message?: string;
}
/**
 * Pure decision: how should this machine launch the backend?
 *
 * Order matters — a local jar always beats a download (no re-fetch for
 * developers), and gradle is the last resort because a cold build takes
 * minutes and needs the local backend sources.
 */
export declare function planBackendLaunch(input: LaunchInput): LaunchPlan;
/** Cache file name for a downloaded jar (keeps the source file name). */
export declare function jarCachePath(dataDir: string, jarUrl: string): string;
/** One redirect-following download with a size cap; atomic via temp + rename. */
export declare function downloadFile(url: string, dest: string, maxBytes: number, onProgress?: (text: string) => void): Promise<void>;
/** Cached jar present and non-trivial (guards against a truncated download). */
export declare function jarCacheUsable(path: string): boolean;
