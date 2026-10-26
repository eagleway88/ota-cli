import type { CheckInput, JsonValue, Release, TargetedMessage } from '../contracts'
import { appName, checkInput, knownKeys, text, userId } from '../contracts/validation'

export type AppSubscription = Omit<CheckInput, 'userId'> & { appName: string }
export interface DeviceTarget {
  appName: string
  uniqueId: string
}
export type SocketListener = (payload?: unknown) => void
export interface WsSocket {
  connected: boolean
  on(event: string, handler: SocketListener): unknown
  off(event: string, handler: SocketListener): unknown
  connect(): unknown
  disconnect(): unknown
  timeout(ms: number): { emitWithAck(event: string, payload: unknown): Promise<unknown> }
}
export type WsAdapter = (
  url: string,
  options: { path: string; transports: string[]; autoConnect: boolean; reconnection: boolean }
) => WsSocket
export interface WsOptions {
  serverURL: string
  adapter: WsAdapter
  path?: string
  timeout?: number
  autoConnect?: boolean
}
export interface MessageAck {
  messageId: string
  acked: boolean
  clientId: string
}
type Entry = { event: string; payload: object; generation: number; ack?: unknown }
type Unsubscribe = () => void

/** Explicit optional peer loading; no Node dependencies enter the Socket bundle. */
export async function loadSocketIoAdapter(
  loader?: () => Promise<{ io?: unknown }>
): Promise<WsAdapter> {
  const moduleName = 'socket.io-client'
  const loaded = (await (loader ? loader() : import(moduleName))) as { io?: unknown }
  if (typeof loaded.io !== 'function')
    throw new Error('Install socket.io-client or supply a WsAdapter')
  return loaded.io as WsAdapter
}
export class OtaWsClient {
  private readonly socket: WsSocket
  private readonly timeout: number
  private generation = 0
  private closed = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly wanted = new Map<string, Entry>()
  private readonly listeners = new Set<Unsubscribe>()
  private readonly errors = new Set<(error: Error) => void>()
  private readonly waiters = new Set<(error: Error) => void>()
  constructor(options: WsOptions) {
    const url = new URL(options.serverURL)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error('serverURL must be an HTTP origin; configure Socket path separately')
    if ('accessKey' in options) throw new Error('Socket clients must not receive an accessKey')
    this.timeout = options.timeout ?? 10000
    if (!Number.isFinite(this.timeout) || this.timeout <= 0)
      throw new Error('timeout must be positive')
    const path = options.path ?? '/socket.io'
    if (!path.startsWith('/') || path.includes('?') || path.includes('#'))
      throw new Error('Invalid Socket path')
    this.socket = options.adapter(url.origin, {
      path,
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true
    })
    this.listen('connect', () => {
      this.generation++
      for (const [key, entry] of this.wanted)
        void this.enqueue(() => this.restore(key, entry)).catch((error) => this.report(error))
    })
    this.listen('connect_error', (error) => this.report(error))
    if (options.autoConnect !== false) this.connect()
  }
  private assertOpen() {
    if (this.closed) throw new Error('Socket client is disposed')
  }
  private report(error: unknown) {
    const normalized = error instanceof Error ? error : new Error('Socket operation failed')
    for (const listener of this.errors) {
      try {
        listener(normalized)
      } catch {
        /* Listener errors must not create unhandled rejections. */
      }
    }
  }
  private listen(event: string, handler: SocketListener): Unsubscribe {
    this.assertOpen()
    this.socket.on(event, handler)
    const off = () => {
      this.socket.off(event, handler)
      this.listeners.delete(off)
    }
    this.listeners.add(off)
    return off
  }
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => {
      this.assertOpen()
      return job()
    })
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
  private async connectedSocket() {
    this.assertOpen()
    if (this.socket.connected) return
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        this.socket.off('connect', connected)
        this.waiters.delete(failed)
        if (error) reject(error)
        else resolve()
      }
      const connected = () => finish()
      const failed = (error: Error) => finish(error)
      const timer = setTimeout(() => finish(new Error('Socket connection timed out')), this.timeout)
      this.waiters.add(failed)
      this.socket.on('connect', connected)
      this.socket.connect()
      if (this.socket.connected) finish()
    })
  }
  private async send<T>(event: string, payload: object): Promise<T> {
    await this.connectedSocket()
    const generation = this.generation
    const response = await this.socket.timeout(this.timeout).emitWithAck(event, payload)
    this.assertOpen()
    if (!this.socket.connected || generation !== this.generation)
      throw new Error('Socket connection changed during acknowledgement')
    if (!response || typeof response !== 'object') throw new Error('Invalid Socket acknowledgement')
    if ('error' in response)
      throw new Error(
        typeof response.error === 'string' ? response.error : 'Socket request rejected'
      )
    return response as T
  }
  private async restore(key: string, entry: Entry) {
    if (this.wanted.get(key) !== entry) return undefined
    if (entry.generation === this.generation && this.socket.connected) return entry.ack
    const ack = await this.send(entry.event, entry.payload)
    entry.generation = this.generation
    entry.ack = ack
    return ack
  }
  private subscribe<T>(key: string, event: string, payload: object): Promise<T> {
    this.assertOpen()
    const entry = { event, payload, generation: -1 }
    this.wanted.set(key, entry)
    return this.enqueue(() => {
      if (this.wanted.get(key) !== entry) throw new Error('Subscription was superseded')
      return this.restore(key, entry)
    }) as Promise<T>
  }
  private unsubscribe<T>(key: string, event: string, payload: object): Promise<T | undefined> {
    this.assertOpen()
    this.wanted.delete(key)
    return this.enqueue(() =>
      this.socket.connected ? this.send<T>(event, payload) : Promise.resolve(undefined)
    )
  }
  private device(target: DeviceTarget) {
    appName(target.appName)
    text(target.uniqueId, 'uniqueId')
    return { appName: target.appName, uniqueId: target.uniqueId }
  }
  private user(value: string) {
    userId(value, value.split(':')[0])
    appName(value.split(':')[0])
    return value
  }
  connect() {
    this.assertOpen()
    if (!this.socket.connected) this.socket.connect()
  }
  suspend() {
    this.assertOpen()
    this.socket.disconnect()
  }
  /** Disposes desired subscriptions and owned listeners. Create another client to reconnect. */
  disconnect() {
    if (this.closed) return
    this.closed = true
    this.wanted.clear()
    for (const reject of [...this.waiters]) reject(new Error('Socket client is disposed'))
    for (const off of [...this.listeners]) off()
    this.socket.disconnect()
    this.errors.clear()
  }
  get connected() {
    return this.socket.connected && !this.closed
  }
  /** Waits for subscription work queued before this call. */
  ready() {
    return this.queue.then(() => undefined)
  }
  onError(handler: (error: Error) => void): Unsubscribe {
    this.assertOpen()
    this.errors.add(handler)
    return () => {
      this.errors.delete(handler)
    }
  }
  onConnect(handler: () => void) {
    return this.listen('connect', handler)
  }
  onDisconnect(handler: (reason: unknown) => void) {
    return this.listen('disconnect', handler)
  }
  subscribeApp(input: AppSubscription) {
    appName(input.appName)
    knownKeys(input, [
      'appName',
      'platform',
      'currentVersion',
      'installedReleaseSequence',
      'architecture',
      'distributionChannel'
    ])
    const { appName: name, ...context } = input
    checkInput(context, name)
    return this.subscribe<{ appName: string }>('app:' + name, 'app:subscribe', {
      appName: name,
      ...context
    })
  }
  unsubscribeApp(name: string) {
    appName(name)
    return this.unsubscribe<{ appName: string }>('app:' + name, 'app:unsubscribe', {
      appName: name
    })
  }
  onUpdate(name: string, handler: (release: Release) => void) {
    appName(name)
    return this.listen('app:' + name + ':update', (value) => handler(value as Release))
  }
  onApplicationMessage<T = JsonValue>(name: string, handler: (data: T) => void) {
    appName(name)
    return this.listen('app:' + name + ':message', (value) => handler(value as T))
  }
  subscribeUser(value: string) {
    this.user(value)
    return this.subscribe<{ uid: string }>('user:' + value, 'userId:subscribe', { userId: value })
  }
  unsubscribeUser(value: string) {
    this.user(value)
    return this.unsubscribe<{ uid: string }>('user:' + value, 'userId:unsubscribe', {
      userId: value
    })
  }
  onUserMessage<T = JsonValue>(value: string, handler: (message: TargetedMessage<T>) => void) {
    this.user(value)
    return this.listen(value, (payload) => handler(payload as TargetedMessage<T>))
  }
  ackUser(input: { userId: string; messageId: string }) {
    this.user(input.userId)
    text(input.messageId, 'messageId')
    if (!this.wanted.has('user:' + input.userId)) throw new Error('User target is not subscribed')
    return this.send<MessageAck & { uid: string }>('userId:ack', { ...input })
  }
  subscribeDevice(target: DeviceTarget) {
    const payload = this.device(target)
    return this.subscribe<{ uniqueId: string }>(
      'device:' + JSON.stringify(payload),
      'uniqueId:subscribe',
      payload
    )
  }
  unsubscribeDevice(target: DeviceTarget) {
    const payload = this.device(target)
    return this.unsubscribe<{ uniqueId: string }>(
      'device:' + JSON.stringify(payload),
      'uniqueId:unsubscribe',
      payload
    )
  }
  onDeviceMessage<T = JsonValue>(
    target: DeviceTarget,
    handler: (message: TargetedMessage<T>) => void
  ) {
    const payload = this.device(target)
    return this.listen('device:' + payload.appName + ':' + payload.uniqueId, (value) =>
      handler(value as TargetedMessage<T>)
    )
  }
  ackDevice(input: DeviceTarget & { messageId: string }) {
    const target = this.device(input)
    text(input.messageId, 'messageId')
    if (!this.wanted.has('device:' + JSON.stringify(target)))
      throw new Error('Device target is not subscribed')
    return this.send<MessageAck & { uniqueId: string }>('uniqueId:ack', {
      ...target,
      messageId: input.messageId
    })
  }
}
export function createWsClient(options: WsOptions) {
  return new OtaWsClient(options)
}
