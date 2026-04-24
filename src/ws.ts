import { io, type Socket } from 'socket.io-client'
import type { VersionRecord } from './types'

export type WsEventPayload = Record<string, unknown>

export type MessageEnvelope<T = unknown> = {
  type?: string
  data?: T
}

export type TargetedMessageEnvelope<T = unknown> = {
  messageId: string | null
  data: T
  updatedAt: string
  expiresAt: string | null
  ackRequired: boolean
}

export type OtaNameSubscriptionPayload = {
  otaName: string
  platform?: string
  architecture?: string
  channel?: string
  ver?: number
  id?: number
}

export type OtaNameMessagePayload = VersionRecord

export type UserIdSubscriptionPayload = {
  userId: string
}

export type UniqueIdSubscriptionPayload = {
  uniqueId: string
}

export type UserIdAckPayload = {
  userId: string
  messageId: string
}

export type UniqueIdAckPayload = {
  uniqueId: string
  messageId: string
}

export type UserIdAckResponse = {
  event: 'userId:acked' | 'userId:error'
  data:
  | {
    uid: string
    messageId: string
    acked: boolean
    clientId: string
  }
  | string
}

export type UniqueIdAckResponse = {
  event: 'uniqueId:acked' | 'uniqueId:error'
  data:
  | {
    uniqueId: string
    messageId: string
    acked: boolean
    clientId: string
  }
  | string
}

export type Unsubscribe = () => void

export interface WsClientOptions {
  baseURL: string
  path?: string
  autoConnect?: boolean
  timeout?: number
  debug?: boolean
}

type SocketEndpoint = {
  url: string
  path: string
}

type ConnectOptions = {
  url?: string
  path?: string
  autoConnect?: boolean
}

type AckError = Error & {
  description?: string
}

type WsLogLevel = 'info' | 'warn' | 'error'

const DEFAULT_TIMEOUT = 10000
const DEFAULT_PATH = '/socket.io'

export class OtaWsClient {
  private socket?: Socket

  private currentUrl?: string

  private currentPath?: string

  private readonly baseURL: string

  private readonly defaultPath: string

  private readonly defaultAutoConnect: boolean

  private readonly defaultTimeout: number

  private debugEnabled: boolean

  constructor(options: WsClientOptions) {
    this.baseURL = options.baseURL
    this.defaultPath = options.path ?? DEFAULT_PATH
    this.defaultAutoConnect = options.autoConnect ?? true
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT
    this.debugEnabled = options.debug ?? false
  }

  setDebugEnabled(enabled: boolean) {
    this.debugEnabled = enabled
    this.log('info', 'debug mode updated', { enabled })
  }

  private log(level: WsLogLevel, message: string, ...args: unknown[]) {
    if (!this.debugEnabled) {
      return
    }

    const payload = ['[ota-cli:ws]', message, ...args]

    if (level === 'error') {
      console.error(...payload)
      return
    }

    if (level === 'warn') {
      console.warn(...payload)
      return
    }

    console.info(...payload)
  }

  private isAckTimeoutError(error: unknown): error is AckError {
    if (!(error instanceof Error)) {
      return false
    }

    const ackError = error as AckError
    return (
      ackError.message.includes('timed out') ||
      ackError.message.includes('timeout') ||
      ackError.description?.includes('timed out') === true ||
      ackError.description?.includes('timeout') === true
    )
  }

  private getSocketEndpoint(overrideUrl?: string, overridePath?: string): SocketEndpoint {
    const rawUrl = overrideUrl ?? this.baseURL
    if (!rawUrl) {
      throw new Error('WebSocket URL is not configured')
    }

    try {
      const parsed = new URL(rawUrl)
      return {
        url: parsed.origin,
        path: overridePath ?? this.defaultPath
      }
    } catch {
      return {
        url: rawUrl,
        path: overridePath ?? this.defaultPath
      }
    }
  }

  private createSocket(url: string, path: string, autoConnect: boolean) {
    const socket = io(url, {
      path,
      transports: ['websocket'],
      autoConnect,
      reconnection: true
    })

    socket.on('connect', () => {
      this.log('info', 'connected', {
        socketId: socket.id ?? '',
        url: this.currentUrl,
        path: this.currentPath
      })
    })

    socket.on('disconnect', reason => {
      this.log('warn', 'disconnected', {
        socketId: socket.id ?? '',
        reason
      })
    })

    socket.on('connect_error', error => {
      this.log('error', 'connect_error', error)
    })

    return socket
  }

  connect(options?: ConnectOptions) {
    const endpoint = this.getSocketEndpoint(options?.url, options?.path)
    const autoConnect = options?.autoConnect ?? this.defaultAutoConnect

    if (
      !this.socket ||
      this.currentUrl !== endpoint.url ||
      this.currentPath !== endpoint.path
    ) {
      this.disconnect()
      this.socket = this.createSocket(endpoint.url, endpoint.path, autoConnect)
      this.currentUrl = endpoint.url
      this.currentPath = endpoint.path
    } else if (!this.socket.connected && autoConnect) {
      this.socket.connect()
    }

    return this.socket
  }

  suspend() {
    if (!this.socket) {
      return
    }

    this.socket.disconnect()
  }

  disconnect() {
    if (!this.socket) {
      return
    }

    this.socket.removeAllListeners()
    this.socket.disconnect()
    this.socket = undefined
    this.currentUrl = undefined
    this.currentPath = undefined
  }

  get connected() {
    return !!this.socket?.connected
  }

  get socketId() {
    return this.socket?.id ?? ''
  }

  private ensureSocket() {
    return this.connect()
  }

  onConnect(handler: (socket: Socket) => void): Unsubscribe {
    const socket = this.ensureSocket()
    const listener = () => handler(socket)
    socket.on('connect', listener)
    return () => socket.off('connect', listener)
  }

  onDisconnect(handler: (reason: string) => void): Unsubscribe {
    const socket = this.ensureSocket()
    socket.on('disconnect', handler)
    return () => socket.off('disconnect', handler)
  }

  onMessage<T = unknown>(handler: (payload: MessageEnvelope<T>) => void): Unsubscribe {
    const socket = this.ensureSocket()
    socket.on('message', handler)
    return () => socket.off('message', handler)
  }

  async emitWithAck<TResponse = unknown>(
    event: string,
    payload?: WsEventPayload | string,
    timeout = this.defaultTimeout
  ) {
    const socket = this.ensureSocket()
    this.log('info', `emitWithAck:${event}`, { payload, timeout })

    try {
      const response = (await socket.timeout(timeout).emitWithAck(event, payload)) as TResponse
      this.log('info', `ack:${event}`, response)
      return response
    } catch (error) {
      const level: WsLogLevel = this.isAckTimeoutError(error) ? 'warn' : 'error'
      this.log(level, `ack_error:${event}`, error)
      throw error
    }
  }

  emit(event: string, payload?: WsEventPayload | string) {
    const socket = this.ensureSocket()
    socket.emit(event, payload)
  }

  async safeEmitWithAck<TResponse = unknown>(
    event: string,
    payload?: WsEventPayload | string,
    timeout = this.defaultTimeout
  ) {
    try {
      return await this.emitWithAck<TResponse>(event, payload, timeout)
    } catch {
      return undefined
    }
  }

  onUserId<T = unknown>(
    userId: string,
    handler: (payload: TargetedMessageEnvelope<T>) => void
  ): Unsubscribe {
    const socket = this.ensureSocket()
    socket.on(userId, handler)
    return () => socket.off(userId, handler)
  }

  subscribeUserId(userId: string) {
    const payload: UserIdSubscriptionPayload = { userId }
    return this.emitWithAck('userId:subscribe', payload)
  }

  unsubscribeUserId(userId: string) {
    const payload: UserIdSubscriptionPayload = { userId }
    return this.safeEmitWithAck('userId:unsubscribe', payload)
  }

  ackUserId(payload: UserIdAckPayload) {
    return this.emitWithAck<UserIdAckResponse>('userId:ack', payload)
  }

  onOtaName(otaName: string, handler: (payload: OtaNameMessagePayload) => void): Unsubscribe {
    const socket = this.ensureSocket()
    socket.on(otaName, handler)
    return () => socket.off(otaName, handler)
  }

  subscribeOtaName(payload: OtaNameSubscriptionPayload) {
    return this.emitWithAck('otaName:subscribe', payload)
  }

  unsubscribeOtaName(otaName: string) {
    return this.safeEmitWithAck('otaName:unsubscribe', { otaName })
  }

  onUniqueId<T = unknown>(
    uniqueId: string,
    handler: (payload: TargetedMessageEnvelope<T>) => void
  ): Unsubscribe {
    const socket = this.ensureSocket()
    socket.on(uniqueId, handler)
    return () => socket.off(uniqueId, handler)
  }

  subscribeUniqueId(uniqueId: string) {
    const payload: UniqueIdSubscriptionPayload = { uniqueId }
    return this.emitWithAck('uniqueId:subscribe', payload)
  }

  unsubscribeUniqueId(uniqueId: string) {
    return this.safeEmitWithAck('uniqueId:unsubscribe', { uniqueId })
  }

  ackUniqueId(payload: UniqueIdAckPayload) {
    return this.emitWithAck<UniqueIdAckResponse>('uniqueId:ack', payload)
  }
}

export function createWsClient(options: WsClientOptions) {
  return new OtaWsClient(options)
}