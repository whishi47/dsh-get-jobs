import type { ResolvedConfig } from '../config.js';
/** Observable backend state. */
export type BackendState = 'unknown' | 'probing' | 'ready' | 'starting' | 'failed';
/** Snapshot returned to callers. */
export interface BackendStatus {
    state: BackendState;
    reachable: boolean;
    managed: boolean;
    pid?: number;
    jar?: string;
    logPath?: string;
    message: string;
}
/** Startup outcome. */
export interface StartResult extends BackendStatus {
    started: boolean;
    waitedMs: number;
}
/** Redact credentials before anything is shown or written to disk. */
export declare function redact(text: string): string;
export declare class BackendSupervisor {
    private readonly config;
    private child;
    private childPid;
    private jarPath;
    private logPath;
    private tail;
    private state;
    private message;
    /** True once a spawn attempt has been made and not yet resolved. */
    private starting;
    /** Set while `stop()` runs, so the exit handler does not treat it as a crash. */
    private stopping;
    /** Set when the process was killed on purpose or restarts are exhausted. */
    private giveUp;
    private restarts;
    private restartTimer;
    /** Dedupe concurrent `ensureRunning` calls (autostart racing with a tool call). */
    private inflight;
    constructor(config: ResolvedConfig);
    /**
     * Project directory: explicit config, then discovery from the plugin's own
     * location (handles both "plugin inside project" and "plugin beside project"),
     * then the host's working directory.
     */
    get projectDir(): string;
    /** Whether `/api/health` answers right now. */
    probe(timeoutMs?: number): Promise<boolean>;
    /** Current status without touching the network. */
    status(): BackendStatus;
    /** Last `lines` log lines, already redacted. */
    logTail(lines?: number): string;
    /**
     * Ensure the backend is running. Cheap path: already reachable → return.
     * Otherwise spawn (jar preferred) and poll until healthy or `waitMs` elapses.
     *
     * Concurrent callers share one attempt: autostart on mount and a user hitting
     * "启动" at the same instant must not spawn two JVMs on the same port.
     */
    ensureRunning(waitMs?: number): Promise<StartResult>;
    private run;
    /**
     * `java` 参数表。这几项在 `gradlew bootRun` 里由 build.gradle.kts 注入，
     * `java -jar` 时必须自己补上，否则 Playwright 会用 PATH 上的旧 Node 起驱动，
     * 报 `SyntaxError: Unexpected token '??='` 并让整个 Spring 上下文启动失败。
     */
    private jarArgs;
    private spawnProcess;
    /**
     * Restart after an unexpected exit.
     *
     * The old build only started the backend once, on mount; if the JVM died the
     * panel kept showing "failed" until the app was restarted. Backoff is capped
     * at {@link MAX_RESTARTS} so a genuinely broken config does not spin forever.
     */
    private scheduleRestart;
    private waitHealthy;
    /**
     * 从日志尾部挑一条能说明问题的行。
     *
     * 面板上只显示"exit 1"等于没说；真正的原因（Playwright 驱动、端口占用、
     * 数据库路径）都在日志里，取第一条命中即可。
     */
    private diagnosis;
    private refreshTail;
    /** Stop the process this plugin started. External backends are left alone. */
    stop(): BackendStatus;
    /** Release resources when the plugin unloads. */
    dispose(): void;
}
