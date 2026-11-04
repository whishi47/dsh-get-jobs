import Schema from '@deepseek-ai/schemastery';
/** Write policy for mutating tools. */
export type MutationPolicy = 'confirm' | 'allow' | 'deny';
/** Configuration accepted by the plugin row. */
export interface Config {
    /** Base URL of the backend. */
    baseUrl?: string;
    /** Backend checkout; defaults to the parent of the plugin directory. */
    projectDir?: string;
    /** `JAVA_HOME` used to launch the backend (JDK 21 required). */
    javaHome?: string;
    /** Explicit jar path; defaults to the newest `build/libs/*.jar`. */
    jarPath?: string;
    /** Jar download URL for machines without a backend checkout; downloaded once into `dataDir`. */
    jarUrl?: string;
    /** SQLite template URL; provisions `db/getjobs.db` in the working directory. */
    dbUrl?: string;
    /** Where downloaded jar/db live; defaults to `<DSH_HOME|~>/.dsh/get-jobs`. */
    dataDir?: string;
    /** Start the backend automatically when the panel mounts. */
    autostart?: boolean;
    /** Per-request HTTP timeout in milliseconds. */
    timeoutMs?: number;
    /** Whether mutating tools run freely, require `confirm: true`, or are refused. */
    mutations?: MutationPolicy;
}
/** Runtime configuration schema. */
export declare const Config: Schema<Config>;
/** Configuration with every field resolved. */
export interface ResolvedConfig {
    baseUrl: string;
    projectDir: string | undefined;
    javaHome: string | undefined;
    jarPath: string | undefined;
    jarUrl: string | undefined;
    dbUrl: string | undefined;
    dataDir: string;
    autostart: boolean;
    timeoutMs: number;
    mutations: MutationPolicy;
}
/** Resolve defaults without hiding them inside individual call sites. */
export declare function resolveConfig(config?: Config): ResolvedConfig;
