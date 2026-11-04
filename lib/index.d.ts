/**
 * dsh-get-jobs — 求职投递自动化插件 for DeepSeek Harness.
 *
 * Node half: own the backend lifecycle (probe → start → stop), expose the
 * status route the panel reads, and give the agent two tools to do the same
 * thing from chat.
 * @module dsh-get-jobs
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type Config as ConfigShape } from './config.js';
/** Plugin id used by the patch row, the client bundle, and the health route. */
export declare const name = "dsh-get-jobs";
/** Tools plus the loopback server the panel reads status from. */
export declare const inject: string[];
/** Route the browser half polls for backend state. */
export declare const HEALTH_PATH = "/dsh-get-jobs/health";
export { Config };
/**
 * Register the toolset, expose the status route, and (optionally) bring the
 * backend up as soon as the plugin mounts.
 */
export declare function apply(ctx: Context, config?: ConfigShape): void;
