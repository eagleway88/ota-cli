import pc from 'picocolors'

const PREFIX = pc.bold(pc.cyan('[ota-cli]'))

export function logStep(message: string) {
  console.log(`${PREFIX} ${pc.blue('->')} ${pc.white(message)}`)
}

export function logSuccess(message: string) {
  console.log(`${PREFIX} ${pc.green('OK')} ${pc.green(message)}`)
}

export function logWarn(message: string) {
  console.warn(`${PREFIX} ${pc.yellow('WARN')} ${pc.yellow(message)}`)
}

export function logError(message: string) {
  console.error(`${PREFIX} ${pc.red('ERR')} ${pc.red(message)}`)
}

export function logJson(title: string, data: unknown) {
  logSuccess(title)
  console.log(JSON.stringify(data, null, 2))
}
