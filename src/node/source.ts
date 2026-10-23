import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import archiver from 'archiver'

export interface PreparedSource {
  filePath: string
  checksumSha256: string
  sizeBytes: number
  cleanup(): Promise<void>
}
export async function prepareSource(input: string): Promise<PreparedSource> {
  const resolved = await realpath(input)
  const info = await stat(resolved)
  let directory: string | undefined
  let filePath = resolved
  try {
    if (info.isDirectory()) {
      directory = await mkdtemp(path.join(tmpdir(), 'ota-cli-'))
      filePath = path.join(directory, 'bundle.zip')
      const entries: string[] = []
      const walk = async (relative: string) => {
        const names = await readdir(path.join(resolved, relative))
        for (const name of names.sort()) {
          const next = path.join(relative, name)
          const entry = await lstat(path.join(resolved, next))
          if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in upload directories')
          if (entry.isDirectory()) await walk(next)
          else if (entry.isFile()) entries.push(next)
          else throw new Error('Unsupported upload directory entry')
        }
      }
      await walk('')
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(filePath, { flags: 'wx', mode: 0o600 })
        const archive = archiver('zip', { zlib: { level: 9 } })
        const failed = (error: Error) => { archive.abort(); output.destroy(); reject(error) }
        output.on('close', resolve); output.on('error', failed)
        archive.on('error', failed); archive.on('warning', failed)
        archive.pipe(output)
        for (const relative of entries) archive.file(path.join(resolved, relative), { name: relative.split(path.sep).join('/'), date: new Date('1980-01-01T00:00:00Z') })
        void archive.finalize().catch(failed)
      })
    } else if (!info.isFile() || path.extname(resolved).toLowerCase() !== '.zip') throw new Error('Upload source must be a ZIP file or a directory')
    const hash = createHash('sha256')
    let sizeBytes = 0
    for await (const chunk of createReadStream(filePath)) { hash.update(chunk as Buffer); sizeBytes += (chunk as Buffer).length }
    return { filePath, checksumSha256: hash.digest('hex'), sizeBytes, cleanup: async () => { if (directory) await rm(directory, { recursive: true, force: true }) } }
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true })
    throw error
  }
}
