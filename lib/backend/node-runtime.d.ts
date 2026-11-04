/** A Node binary usable as the Playwright driver runtime. */
export interface NodeInfo {
    path: string;
    version: string;
    source: 'host' | 'PATH' | 'scan';
}
/**
 * Resolve a Node 18+ binary.
 *
 * Order matters: the host process itself is the most reliable source — DSH runs
 * on a recent Node, so `process.execPath` is both present and new enough.
 */
export declare function detectNode(): NodeInfo | undefined;
