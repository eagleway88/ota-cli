import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeBaseURL } from '../http'

interface TokenCacheEntry {
  username?: string
  token: string
  updatedAt: string
}

interface TokenCacheFile {
  sessions: Record<string, TokenCacheEntry>
}

const CACHE_DIR = path.join(os.homedir(), '.eagleway', 'ota-cli')
const CACHE_FILE = path.join(CACHE_DIR, 'auth.json')

export async function readCachedSession(baseURL: string) {
  const cache = await readCacheFile()
  return cache.sessions[normalizeBaseURL(baseURL)]
}

export async function writeCachedSession(baseURL: string, session: { username?: string; token: string }) {
  const cache = await readCacheFile()
  cache.sessions[normalizeBaseURL(baseURL)] = {
    username: session.username,
    token: session.token,
    updatedAt: new Date().toISOString()
  }
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8')
}

export async function clearCachedSession(baseURL: string) {
  const cache = await readCacheFile()
  delete cache.sessions[normalizeBaseURL(baseURL)]

  if (!Object.keys(cache.sessions).length) {
    await rm(CACHE_FILE, { force: true })
    return
  }

  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8')
}

async function readCacheFile(): Promise<TokenCacheFile> {
  try {
    const content = await readFile(CACHE_FILE, 'utf8')
    const parsed = JSON.parse(content) as TokenCacheFile
    return { sessions: parsed.sessions || {} }
  } catch {
    return { sessions: {} }
  }
}
