import { platforms, type CheckInput, type DraftInput, type Platform } from './index'

export function object(value: unknown, label = 'input'): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(label + ' must be an object')
}
export function knownKeys(value: object, keys: readonly string[]) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key))
  if (unknown.length) throw new Error('Unknown fields: ' + unknown.join(', '))
}
export function appName(value: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))
    throw new Error('Invalid appName')
  return value
}
export function integer(value: unknown, label: string, min = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 2147483647)
    throw new Error(label + ' must be an integer between ' + min + ' and 2147483647')
}
export function text(value: unknown, label: string, max = 191): asserts value is string {
  if (typeof value !== 'string' || !value.length || value.length > max)
    throw new Error('Invalid ' + label)
}
export function platform(value: unknown): asserts value is Platform {
  if (!platforms.includes(value as Platform)) throw new Error('Invalid platform')
}
export function checkInput(input: CheckInput, app: string) {
  object(input)
  knownKeys(input, [
    'platform',
    'nativeVersionCode',
    'installedReleaseSequence',
    'architecture',
    'distributionChannel',
    'userId'
  ])
  platform(input.platform)
  integer(input.nativeVersionCode, 'nativeVersionCode')
  if (input.installedReleaseSequence !== undefined)
    integer(input.installedReleaseSequence, 'installedReleaseSequence')
  for (const key of ['architecture', 'distributionChannel'] as const)
    if (input[key] !== undefined) text(input[key], key, 128)
  if (input.userId !== undefined) userId(input.userId, app, [input.platform])
}
export function userId(
  value: unknown,
  app: string,
  allowedPlatforms: readonly string[] = platforms
) {
  text(value, 'userId')
  const [application, targetPlatform, ...businessId] = value.split(':')
  if (application !== app || !allowedPlatforms.includes(targetPlatform) || !businessId.join(':'))
    throw new Error('userId must match appName:platform:businessId')
}
export function jsonValue(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || depth > 100 || ancestors.has(value))
    throw new Error('Expected finite, acyclic JSON data')
  if (
    !Array.isArray(value) &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
  )
    throw new Error('Expected plain JSON data')
  ancestors.add(value)
  for (const item of Array.isArray(value) ? value : Object.values(value))
    jsonValue(item, ancestors, depth + 1)
  ancestors.delete(value)
}
export function queryInput(query: object, fields: readonly string[]) {
  object(query)
  knownKeys(query, fields)
  if (query.page !== undefined) {
    integer(query.page, 'page', 1)
    if (query.page > 999999) throw new Error('page exceeds 999999')
  }
  if (query.pageSize !== undefined) {
    integer(query.pageSize, 'pageSize', 1)
    if (query.pageSize > 100) throw new Error('pageSize exceeds 100')
  }
  for (const key of ['from', 'to'])
    if (
      query[key] !== undefined &&
      (typeof query[key] !== 'string' ||
        !/(?:Z|[+-]\d{2}:\d{2})$/.test(query[key]) ||
        !Number.isFinite(Date.parse(query[key])))
    )
      throw new Error('Invalid ISO time with timezone: ' + key)
  if (query.from !== undefined || query.to !== undefined) {
    const to = query.to === undefined ? Date.now() : Date.parse(String(query.to))
    const from = query.from === undefined ? to - 30 * 86400000 : Date.parse(String(query.from))
    if (from >= to || to - from > 90 * 86400000)
      throw new Error('Query window must be positive and at most 90 days')
  }
  if (query.platform !== undefined) platform(query.platform)
  if (query.releaseSequence !== undefined) integer(query.releaseSequence, 'releaseSequence', 1)
}
export const draftKeys = [
  'targetVersionCode',
  'baseVersionCodes',
  'platforms',
  'architectures',
  'distributionChannel',
  'updateType',
  'releaseScope',
  'userIds',
  'releaseNotes',
  'artifactId',
  'installerSourceUrl',
  'bundleUrl',
  'artifactSizeBytes',
  'enabled',
  'mandatory',
  'showUpdateDialog'
] as const
export function draftPatch(input: Partial<DraftInput>, app: string) {
  object(input)
  knownKeys(input, draftKeys)
  if (!Object.keys(input).length) throw new Error('Draft patch must not be empty')
  const skeleton: DraftInput = {
    targetVersionCode: 0,
    baseVersionCodes: [0],
    platforms: [...platforms],
    updateType: 'full',
    artifactId: 'pending-resource',
    releaseScope: 'public',
    userIds: [],
    ...input
  }
  // A partial update can rely on the current resource; validate its supplied fields locally.
  if (input.updateType === 'hot' && input.baseVersionCodes === undefined)
    skeleton.baseVersionCodes = [0]
  draftInput(skeleton, app)
}
export function draftInput(input: DraftInput, app: string) {
  object(input)
  knownKeys(input, draftKeys)
  integer(input.targetVersionCode, 'targetVersionCode')
  if (!Array.isArray(input.baseVersionCodes)) throw new Error('baseVersionCodes must be an array')
  input.baseVersionCodes.forEach((value) => integer(value, 'baseVersionCodes'))
  if (!Array.isArray(input.platforms) || !input.platforms.length)
    throw new Error('platforms must be a nonempty array')
  input.platforms.forEach(platform)
  if (input.architectures !== undefined) {
    if (!Array.isArray(input.architectures)) throw new Error('architectures must be an array')
    input.architectures.forEach((value) => text(value, 'architecture', 128))
  }
  if (!['hot', 'full'].includes(input.updateType)) throw new Error('Invalid updateType')
  if (input.updateType === 'hot' && !input.baseVersionCodes.length)
    throw new Error('Hot updates require baseVersionCodes')
  if (!['public', 'allowlist'].includes(input.releaseScope))
    throw new Error('Explicit releaseScope is required')
  if (!Array.isArray(input.userIds) || input.userIds.length > 5000)
    throw new Error('userIds must be an array of at most 5000 values')
  input.userIds.forEach((value) => userId(value, app, input.platforms))
  for (const key of ['enabled', 'mandatory', 'showUpdateDialog'] as const)
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      throw new Error(key + ' must be boolean')
  if (input.artifactSizeBytes !== undefined) integer(input.artifactSizeBytes, 'artifactSizeBytes')
  if (input.artifactId !== undefined) text(input.artifactId, 'artifactId', 36)
  if (input.distributionChannel !== undefined)
    text(input.distributionChannel, 'distributionChannel', 128)
  if (input.releaseNotes !== undefined && typeof input.releaseNotes !== 'string')
    throw new Error('releaseNotes must be a string')
  for (const key of ['bundleUrl', 'installerSourceUrl'] as const)
    if (input[key] !== undefined) {
      const url = new URL(input[key]!)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Invalid ' + key)
    }
  if (!input.artifactId && !input.bundleUrl && !input.installerSourceUrl)
    throw new Error('A release artifact or URL is required')
  if (input.updateType === 'hot' && !input.artifactId && !input.bundleUrl)
    throw new Error('Hot updates require artifactId or bundleUrl')
  if (input.updateType === 'full' && !input.artifactId && !input.installerSourceUrl)
    throw new Error('Full updates require artifactId or installerSourceUrl')
}
