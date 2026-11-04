/**
 * JDK discovery and jar selection for the backend.
 *
 * The backend needs JDK 21; the host machine may have several JDKs and a
 * default `java` that is far too old, so the launcher resolves an explicit home
 * instead of trusting PATH.
 * @module dsh-get-jobs/backend/jdk
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One usable JDK installation. */
export interface JdkInfo {
  home: string
  version: string
  source: 'config' | 'JAVA_HOME' | 'scan'
}

function versionOf(home: string): string | undefined {
  const release = join(home, 'release')
  if (existsSync(release)) {
    const match = readFileSync(release, 'utf8').match(/JAVA_VERSION="([^"]+)"/)
    if (match?.[1]) return match[1]
  }
  const bin = process.platform === 'win32' ? join(home, 'bin', 'java.exe') : join(home, 'bin', 'java')
  return existsSync(bin) ? 'unknown' : undefined
}

function isJava21(home: string): boolean {
  const version = versionOf(home)
  return Boolean(version && version.startsWith('21'))
}

function expandCandidates(): string[] {
  const roots: string[] = []
  if (process.platform === 'win32') {
    roots.push('C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium')
    roots.push(join(homedir(), '.jdks'), join(homedir(), '.gradle', 'jdks'))
  } else {
    roots.push('/usr/lib/jvm', join(homedir(), '.jdks'), join(homedir(), '.gradle', 'jdks'))
  }
  return roots
}

function scan(): string[] {
  const found: string[] = []
  for (const root of expandCandidates()) {
    if (!existsSync(root)) continue
    let entries: string[] = []
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!/21/.test(entry)) continue
      const home = join(root, entry)
      try {
        if (statSync(home).isDirectory()) found.push(home)
      } catch {
        // Unreadable entries are simply skipped.
      }
    }
  }
  return found
}

/**
 * Resolve a JDK 21 home: explicit config first, then `JAVA_HOME`, then a scan of
 * the usual install roots.
 */
export function detectJdk21(explicit?: string): JdkInfo | undefined {
  if (explicit && isJava21(explicit)) {
    return { home: explicit, version: versionOf(explicit) ?? '21', source: 'config' }
  }
  const envHome = process.env['JAVA_HOME']
  if (envHome && isJava21(envHome)) {
    return { home: envHome, version: versionOf(envHome) ?? '21', source: 'JAVA_HOME' }
  }
  for (const home of scan()) {
    if (isJava21(home)) {
      return { home, version: versionOf(home) ?? '21', source: 'scan' }
    }
  }
  return undefined
}

/**
 * Pick the newest runnable jar under `build/libs`, ignoring `-plain` artifacts.
 *
 * The fat jar produced by the Gradle build is matched by a loose name pattern:
 * any application jar that is not a `-plain`/`-sources`/`-javadoc` variant. This
 * avoids tying the launcher to a single hardcoded jar stem.
 */
export function findJar(projectDir: string, explicit?: string): string | undefined {
  if (explicit && existsSync(explicit)) return explicit
  const libs = join(projectDir, 'build', 'libs')
  if (!existsSync(libs)) return undefined
  const jars = readdirSync(libs)
    .filter((name) => /\.jar$/.test(name) && !/-(plain|sources|javadoc|tests)\.jar$/.test(name))
    .map((name) => ({ name, time: statSync(join(libs, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
  const newest = jars[0]
  return newest ? join(libs, newest.name) : undefined
}

/** Gradle wrapper command for the current platform. */
export function gradleCommand(projectDir: string): { command: string; args: string[] } | undefined {
  const win = process.platform === 'win32'
  const names = win ? ['gradlew.bat', 'gradlew'] : ['gradlew', 'gradlew.bat']
  for (const name of names) {
    if (existsSync(join(projectDir, name))) {
      return { command: name, args: ['bootRun', '--console=plain'] }
    }
  }
  return undefined
}
