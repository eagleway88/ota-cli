import type { RequestEvent } from '../../contracts'
import type { PublisherProgressEvent } from '../../node/progress'
import { redact } from './redact'

type Output = Pick<NodeJS.WriteStream, 'write' | 'isTTY' | 'columns'>
export type ProgressMode = 'auto' | 'always' | 'never'

const labels: Record<PublisherProgressEvent['phase'], string> = {
  target: 'Deploying',
  preparing: 'Preparing files',
  packing: 'Packing ZIP',
  hashing: 'Calculating SHA-256',
  prepared: 'Files prepared',
  uploading: 'Uploading',
  'upload-sent': 'Upload sent; waiting for server confirmation',
  uploaded: 'Upload confirmed and verified',
  reused: 'Reusing uploaded artifact',
  resuming: 'Resuming deployment',
  creating: 'Creating draft',
  draft: 'Draft created',
  publishing: 'Publishing release',
  published: 'Release published',
  waiting: 'Waiting for dispatch task',
  task: 'Dispatch task',
  completed: 'Completed',
  failed: 'Failed'
}
const milestones = new Set(['prepared', 'uploaded', 'reused', 'draft', 'published'])
const bytes = (value: number) => {
  if (value < 1024) return Math.round(value) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KiB'
  return (value / 1024 / 1024).toFixed(1) + ' MiB'
}

export class ProgressDisplay {
  private readonly enabled: boolean
  private readonly tty: boolean
  private label = ''
  private key = ''
  private started = 0
  private uploadStarted = 0
  private frame = 0
  private visible = false
  private semantic = false
  private pending?: ReturnType<typeof setTimeout>
  private animation?: ReturnType<typeof setInterval>
  private lastPlain = 0
  private prefix = ''

  constructor(
    private readonly mode: ProgressMode,
    json: boolean,
    private readonly operation: string,
    private readonly output: Output = process.stderr,
    ci = Boolean(process.env.CI)
  ) {
    this.enabled = !json && mode !== 'never' && (mode === 'always' || Boolean(output.isTTY && !ci))
    this.tty = this.enabled && Boolean(output.isTTY)
  }

  private clean(message: string) {
    return redact(message).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
  }
  private clear() {
    if (this.visible && this.tty) this.output.write('\r\x1b[2K')
    this.visible = false
  }
  private elapsed() {
    return ((Date.now() - this.started) / 1000).toFixed(1) + 's'
  }
  private draw() {
    if (!this.label) return
    const line = this.clean(
      '|/-\\'[this.frame++ % 4] + ' ' + this.label + ' (' + this.elapsed() + ')'
    )
    this.clear()
    this.output.write('\r' + line.slice(0, Math.max(1, (this.output.columns ?? 100) - 1)))
    this.visible = true
  }
  private update(label: string, key: string, delay = 0, forceLog = false) {
    if (!this.enabled) return
    const changed = key !== this.key
    this.label = label
    if (changed) {
      this.close()
      this.label = label
      this.key = key
      this.started = Date.now()
    }
    if (this.tty) {
      if (!this.animation && !this.pending) {
        const start = () => {
          this.pending = undefined
          this.draw()
          this.animation = setInterval(() => this.draw(), 100)
          this.animation.unref()
        }
        if (delay) this.pending = setTimeout(start, delay)
        else start()
      }
    } else if (forceLog || changed || Date.now() - this.lastPlain >= 1000) {
      this.output.write(this.clean(label) + '\n')
      this.lastPlain = Date.now()
      this.visible = true
    }
  }

  readonly onRequest = (event: RequestEvent) => {
    if (this.semantic || !this.enabled) return
    if (event.phase === 'start')
      this.update(
        this.operation + ': waiting for response',
        'request',
        this.mode === 'auto' ? 200 : 0
      )
    else this.finish(event.phase === 'success')
  }

  readonly onProgress = (event: PublisherProgressEvent) => {
    if (!this.enabled) return
    this.semantic = true
    if (event.phase === 'target')
      this.prefix = '[' + event.index + '/' + event.count + ' ' + event.target + '] '
    const prefix = event.target ? this.prefix || '[' + event.target + '] ' : ''
    let label = prefix + labels[event.phase]
    if (event.phase === 'uploading') {
      if (this.key !== prefix + 'uploading') this.uploadStarted = Date.now()
      const loaded = event.loaded ?? 0
      const size =
        event.total && event.total > 0
          ? Math.min(100, Math.floor((loaded / event.total) * 100)) +
            '% ' +
            bytes(loaded) +
            '/' +
            bytes(event.total)
          : bytes(loaded)
      const seconds = (Date.now() - this.uploadStarted) / 1000
      label += ' ' + size + (seconds > 0 && loaded > 0 ? ' ' + bytes(loaded / seconds) + '/s' : '')
    }
    if (event.phase === 'upload-sent' && event.total && event.total > 0) label += ' (100%)'
    if (event.phase === 'resuming') label += ' from ' + event.resumePhase
    if (event.taskStatus) label += ': ' + event.taskStatus
    if (event.phase === 'completed' || event.phase === 'failed') {
      this.finish(event.phase === 'completed', label)
      return
    }
    const key = prefix + (event.phase === 'task' ? 'waiting' : event.phase)
    // Repeated polling updates the same row and only logs when the status changes.
    if (event.phase === 'task' && this.label === label) return
    const changedStatus = event.phase === 'task' && this.label !== label
    if (milestones.has(event.phase)) this.finish(true, label)
    else this.update(label, key, 0, changedStatus)
  }

  log(message: string) {
    this.clear()
    this.output.write(redact(message) + '\n')
    if (this.animation) this.draw()
  }
  finish(success: boolean, message?: string) {
    const label = message ?? this.label
    const elapsed = this.started ? this.elapsed() : '0.0s'
    const shown = this.visible || Boolean(message)
    this.close()
    if (this.enabled && label && shown)
      this.output.write(
        this.clean((success ? '[ok] ' : '[failed] ') + label + ' (' + elapsed + ')') + '\n'
      )
  }
  close() {
    if (this.pending) clearTimeout(this.pending)
    if (this.animation) clearInterval(this.animation)
    this.pending = undefined
    this.animation = undefined
    this.clear()
    this.label = ''
    this.key = ''
  }
}
