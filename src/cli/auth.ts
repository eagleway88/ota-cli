import { createOtaClient } from '../client'
import type { RequestOptions } from '../types'
import type { ResolvedCliOptions } from './utils'
import { readCachedSession, writeCachedSession } from './cache'
import { logStep, logSuccess } from './logger'
import { promptForCredentials } from './prompt'

export async function resolveAuthToken(options: ResolvedCliOptions) {
  if (options.token) {
    logStep('using token from command arguments or config file')
    return options.token
  }

  const cached = await readCachedSession(options.baseURL)
  if (cached?.token) {
    logStep('using cached token from local machine')
    return cached.token
  }

  const credentials = await resolveCredentials(options, cached?.username)
  logStep(`logging in as ${credentials.username}`)

  const client = createOtaClient(stripCredentials(options))
  const token = await client.admin.login({
    username: credentials.username,
    password: credentials.password
  })

  await writeCachedSession(options.baseURL, {
    username: credentials.username,
    token
  })
  logSuccess('login successful, token cached locally')
  return token
}

export function stripCredentials(options: ResolvedCliOptions): RequestOptions {
  return {
    baseURL: options.baseURL,
    token: options.token,
    timeout: options.timeout,
    headers: options.headers
  }
}

async function resolveCredentials(options: ResolvedCliOptions, cachedUsername?: string) {
  if (options.username && options.password) {
    return {
      username: options.username,
      password: options.password
    }
  }

  if (options.username && !options.password) {
    const prompted = await promptForCredentials(options.username)
    return {
      username: options.username,
      password: prompted.password
    }
  }

  return promptForCredentials(cachedUsername)
}
