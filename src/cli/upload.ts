import fs from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import archiver from 'archiver'
import FormData from 'form-data'
import { createHttpClient, normalizeApiError, unwrapEnvelope } from '../http'
import type { RequestOptions, VersionRecord } from '../types'
import { logStep } from './logger'

export async function uploadVersion(
  options: RequestOptions,
  filePath: string,
  body: Record<string, unknown>
) {
  const prepared = await prepareUploadSource(filePath)
  const fileSize = fs.statSync(prepared.filePath).size
  logStep(`upload zip size: ${formatFileSize(fileSize)}`)

  const form = new FormData()
  form.append('file', fs.createReadStream(prepared.filePath))

  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) {
      continue
    }
    form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
  }

  const client = createHttpClient(options)
  try {
    const response = await client.post('/version/upload', form, {
      headers: form.getHeaders()
    })

    return unwrapEnvelope<VersionRecord>(response)
  } catch (error) {
    throw normalizeApiError(error)
  } finally {
    await prepared.cleanup()
  }
}

async function prepareUploadSource(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const stats = fs.statSync(filePath)
  if (stats.isFile()) {
    if (path.extname(filePath).toLowerCase() !== '.zip') {
      throw new Error('upload file must be a .zip file, or provide a directory to compress before upload')
    }

    logStep(`using zip file directly: ${filePath}`)
    return {
      filePath,
      cleanup: async () => {}
    }
  }

  if (stats.isDirectory()) {
    const zipPath = await zipDirectory(filePath)
    return {
      filePath: zipPath,
      cleanup: async () => {
        logStep(`removing temporary zip file: ${zipPath}`)
        await rm(zipPath, { force: true })
      }
    }
  }

  throw new Error('upload path must be a .zip file or a directory')
}

async function zipDirectory(directoryPath: string) {
  const zipPath = path.join(os.tmpdir(), `ota-cli-${randomUUID()}.zip`)
  logStep(`compressing directory to temporary zip: ${zipPath}`)

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory(directoryPath, false)
    void archive.finalize()
  })

  return zipPath
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB']
  let size = bytes / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`
}
