/**
 * Typed HTTP client for the Get Jobs REST API. Errors carry an actionable
 * sentence so tool output tells the user what to do next.
 * @module dsh-get-jobs/api/client
 */
import type { ResolvedConfig } from '../config.js';
/** The backend could not be reached at all. */
export declare class BackendUnreachable extends Error {
    constructor(baseUrl: string, detail: string);
}
/** The backend answered with a non-2xx status. */
export declare class BackendHttpError extends Error {
    readonly path: string;
    readonly status: number;
    readonly body: unknown;
    constructor(path: string, status: number, body: unknown, message: string);
}
/** Query values accepted by {@link GetJobsClient.get}. */
export type QueryValue = string | number | boolean | Array<string | number> | null | undefined;
/** One JSON-over-HTTP client bound to the resolved configuration. */
export declare class GetJobsClient {
    private readonly config;
    constructor(config: ResolvedConfig);
    get baseUrl(): string;
    /** Low-level request; callers usually use the helpers below. */
    request<T>(method: string, path: string, options?: {
        query?: Record<string, QueryValue>;
        body?: unknown;
        timeoutMs?: number;
    }): Promise<T>;
    get<T>(path: string, options?: {
        query?: Record<string, QueryValue>;
        timeoutMs?: number;
    }): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    put<T>(path: string, body: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
}
