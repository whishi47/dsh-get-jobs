/** One usable JDK installation. */
export interface JdkInfo {
    home: string;
    version: string;
    source: 'config' | 'JAVA_HOME' | 'scan';
}
/**
 * Resolve a JDK 21 home: explicit config first, then `JAVA_HOME`, then a scan of
 * the usual install roots.
 */
export declare function detectJdk21(explicit?: string): JdkInfo | undefined;
/**
 * Pick the newest runnable jar under `build/libs`, ignoring `-plain` artifacts.
 *
 * The fat jar produced by the Gradle build is matched by a loose name pattern:
 * any application jar that is not a `-plain`/`-sources`/`-javadoc` variant. This
 * avoids tying the launcher to a single hardcoded jar stem.
 */
export declare function findJar(projectDir: string, explicit?: string): string | undefined;
/** Gradle wrapper command for the current platform. */
export declare function gradleCommand(projectDir: string): {
    command: string;
    args: string[];
} | undefined;
