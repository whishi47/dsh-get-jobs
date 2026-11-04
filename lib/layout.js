/**
 * Plugin location on disk. Paths resolve from the package itself, never from
 * the host process's working directory (which is unrelated once mounted).
 * @module dsh-get-jobs/layout
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/** `<package>/lib/layout.js` → `<package>`. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Markers that identify a backend checkout (Gradle wrapper + the SQLite db dir). */
const PROJECT_MARKERS = ['gradlew', join('db', 'getjobs.db')];
/** How many parent directories to inspect before giving up. */
const MAX_DEPTH = 4;
function isProjectRoot(dir) {
    return PROJECT_MARKERS.every((marker) => existsSync(join(dir, marker)));
}
/**
 * Locate the backend checkout starting from a directory.
 *
 * Two layouts are supported, because both are in use:
 *
 * - plugin **inside** the project — `<backend>/dsh-get-jobs/` (parent is the root)
 * - plugin **beside** the project — `<workspace>/dsh-get-jobs/` next to `<workspace>/<backend>/`
 *
 * The second one is why a plain `resolve(root, '..')` is not enough: the parent
 * of a sibling install is not a project at all. The backend root is detected by
 * its markers (gradlew + db/getjobs.db), never by a hardcoded directory name.
 *
 * @param start directory to start from (usually {@link PACKAGE_ROOT})
 * @returns the project root, or `undefined` when nothing looks like one
 */
export function findProjectRoot(start = PACKAGE_ROOT) {
    let current = resolve(start);
    for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
        if (isProjectRoot(current))
            return current;
        // 检查当前目录的子目录里是否有后端工程根（通过标记识别，不依赖目录名）
        try {
            for (const entry of readdirSync(current)) {
                const candidate = join(current, entry);
                if (isProjectRoot(candidate))
                    return candidate;
            }
        }
        catch {
            // 不可读目录直接跳过
        }
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    return undefined;
}
