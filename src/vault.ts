import type { FileSystemLike, IdeaConfig, IdeaFileSummary } from './types.js'

const supported = new Set(['.md', '.mdown', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.ndjson'])

function childPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, '')}\\${name}`
}

function extension(path: string): string {
  const match = path.match(/\.[^.\\/]+$/)
  return match?.[0]?.toLowerCase() ?? ''
}

export interface IdeaVaultScan {
  root: string
  files: IdeaFileSummary[]
  skippedFiles: number
  errors: string[]
}

export async function scanIdeaVault(
  fs: FileSystemLike,
  root: string,
  config: IdeaConfig,
  signal?: AbortSignal,
): Promise<IdeaVaultScan> {
  const target = await fs.resolve(root, { signal })
  const files: IdeaFileSummary[] = []
  const errors: string[] = []
  let skippedFiles = 0
  const walk = async (currentPath: string, currentTarget: unknown): Promise<void> => {
    if (files.length >= config.maxFiles) return
    let entries: Awaited<ReturnType<FileSystemLike['listDir']>>
    try {
      entries = await fs.listDir(currentTarget, signal)
    } catch (error) {
      errors.push(`${currentPath}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    for (const entry of entries) {
      if (files.length >= config.maxFiles) break
      const path = childPath(currentPath, entry.name)
      if (entry.type === 'directory') {
        if (entry.name.startsWith('.')) continue
        await walk(path, entry.target)
        continue
      }
      const ext = extension(entry.name)
      if (!supported.has(ext)) {
        skippedFiles += 1
        continue
      }
      if ((entry.size ?? 0) > config.maxFileBytes) {
        files.push({ path, extension: ext, size: entry.size ?? 0, status: 'skipped', reason: `exceeds maxFileBytes (${config.maxFileBytes})` })
        continue
      }
      files.push({ path, extension: ext, size: entry.size ?? 0, status: 'supported' })
    }
  }
  await walk(root, target)
  return { root, files, skippedFiles, errors }
}
