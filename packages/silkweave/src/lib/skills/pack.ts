import { fileBytes, pluginFiles, resolveSkill } from '@silkweave/skills'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** npm package name shape (scoped or unscoped). */
const PACKAGE_NAME_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

export interface PackOptions {
  /** Skill directory containing SKILL.md. */
  dir: string
  /** npm package name; defaults to the skill's `npmPackage` (frontmatter `metadata.npmPackage`), else `<name>-skill`. */
  packageName?: string
  /** Output directory; defaults to `dist/<name>-plugin`. */
  out?: string
  /** Registry consulted for the already-published check. */
  registry?: string
  /** Pack even when the version is already published. */
  force?: boolean
  fetch?: typeof fetch
}

export interface PackResult {
  outDir: string
  packageName: string
  version: string
  /** Non-fatal notes (e.g. the registry could not be reached for the published check). */
  warnings: string[]
}

/**
 * Published versions of a package, or `undefined` when the registry cannot be
 * reached (offline packing stays possible - the caller warns instead).
 */
async function publishedVersions(packageName: string, registry: string, fetchImpl: typeof fetch): Promise<string[] | undefined> {
  try {
    const response = await fetchImpl(`${registry.replace(/\/$/, '')}/${packageName.replace('/', '%2f')}`)
    if (response.status === 404) { return [] }
    if (!response.ok) { return undefined }
    const body = await response.json() as { versions?: Record<string, unknown> }
    return Object.keys(body.versions ?? {})
  } catch {
    return undefined
  }
}

/**
 * The output directory is recreated from scratch, but only when it is empty or
 * clearly a previous pack output (it has `.claude-plugin/plugin.json`) - a
 * `--out` pointing at unrelated files errors instead of deleting them.
 */
async function prepareOutDir(outDir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(outDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(outDir, { recursive: true })
      return
    }
    throw error
  }
  if (entries.length) {
    const marker = await stat(join(outDir, '.claude-plugin', 'plugin.json')).catch(() => undefined)
    if (!marker?.isFile()) {
      throw new Error(`Output directory ${outDir} is not empty and not a previous pack output - refusing to overwrite`)
    }
    await rm(outDir, { recursive: true, force: true })
  }
  await mkdir(outDir, { recursive: true })
}

/**
 * Pack one skill directory into a skills-only Claude Code plugin package:
 * `package.json` + `.claude-plugin/plugin.json` + `skills/<name>/...`, ready
 * for `npm publish`. Refuses a version that is already on the registry
 * (`/plugin update` keys on the version, so republishing changed content
 * under an old version would strand installs) unless `force` is set.
 */
export async function packSkill(options: PackOptions): Promise<PackResult> {
  const fetchImpl = options.fetch ?? fetch
  const registry = options.registry ?? DEFAULT_REGISTRY
  const warnings: string[] = []
  const skill = await resolveSkill({ dir: options.dir })
  const packageName = options.packageName ?? skill.npmPackage ?? `${skill.name}-skill`
  if (!PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new Error(`'${packageName}' is not a valid npm package name`)
  }
  const files = pluginFiles(skill, { npmPackage: packageName })
  const version = skill.version!
  const versions = await publishedVersions(packageName, registry, fetchImpl)
  if (versions === undefined) {
    warnings.push(`could not reach ${registry} to check for an existing ${packageName}@${version} - packing anyway`)
  } else if (versions.includes(version)) {
    if (!options.force) {
      throw new Error(
        `${packageName}@${version} is already published - bump the skill's metadata.version (or pass --force to pack anyway)`
      )
    }
    warnings.push(`${packageName}@${version} is already published - packed anyway (--force)`)
  }
  const outDir = resolve(options.out ?? join('dist', `${skill.name}-plugin`))
  await prepareOutDir(outDir)
  for (const [path, data] of Object.entries(files)) {
    const destination = join(outDir, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, typeof data === 'string' ? data : fileBytes(data))
  }
  return { outDir, packageName, version, warnings }
}
