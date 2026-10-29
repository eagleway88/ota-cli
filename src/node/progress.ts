import type { RequestControl, TaskStatus } from '../contracts'

/** 发布器的诊断事件；字节数指 multipart 请求体，不代表服务端已确认接收。 */
export interface PublisherProgressEvent {
  phase:
    | 'target'
    | 'preparing'
    | 'packing'
    | 'hashing'
    | 'prepared'
    | 'uploading'
    | 'upload-sent'
    | 'uploaded'
    | 'reused'
    | 'resuming'
    | 'creating'
    | 'draft'
    | 'publishing'
    | 'published'
    | 'waiting'
    | 'task'
    | 'completed'
    | 'failed'
  appName: string
  target?: string
  index?: number
  count?: number
  loaded?: number
  total?: number
  taskStatus?: TaskStatus
  resumePhase?: string
}
export interface WaitOptions extends RequestControl {
  timeout?: number
  pollInterval?: number
  /** 观察器异常不会影响任务等待。 */
  onProgress?: (event: PublisherProgressEvent) => void
}
