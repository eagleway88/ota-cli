export const secrets = new Set<string>()
export function redact(value: string) {
  let result = value.replace(/ota_ak_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/g, '[REDACTED]')
  for (const secret of secrets) result = result.split(secret).join('[REDACTED]')
  return result
}
