/** `<package>/lib/layout.js` → `<package>`. */
export declare const PACKAGE_ROOT: string;
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
export declare function findProjectRoot(start?: string): string | undefined;
