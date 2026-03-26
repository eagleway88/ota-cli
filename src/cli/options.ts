export interface GlobalCliOptions {
  baseUrl?: string
  token?: string
  authUsername?: string
  authPassword?: string
  timeout?: string
  headers?: string
}

export interface AdminAuthCommandOptions extends GlobalCliOptions {
  username: string
  password: string
}

export interface NotifySendCommandOptions extends GlobalCliOptions {
  type: string
  data?: string
}

export interface VersionCheckCommandOptions extends GlobalCliOptions {
  name: string
  ver: string
  platform: string
  channel?: string
  id?: string
}

export interface VersionCreateCommandOptions extends GlobalCliOptions {
  name?: string
  ver?: string
  platform?: string
  desc?: string
  fileSize?: string
  enable?: string
  mandatory?: string
  installUrl?: string
  packageUrl?: string
  channel?: string
}

export interface VersionUploadCommandOptions extends GlobalCliOptions {
  file?: string
  name?: string
  ver?: string
  platform?: string
  desc?: string
  enable?: string
  mandatory?: string
  installUrl?: string
  channel?: string
}

export interface VersionSuccessCommandOptions extends GlobalCliOptions {
  name: string
  platform: string
  ver: string
  verId: string
  username?: string
  extras?: string
}

export interface VersionErrorCommandOptions extends GlobalCliOptions {
  id?: string
  name: string
  platform: string
  ver: string
  verId: string
  username?: string
  extras?: string
  message: string
}

export interface VersionAppErrorCommandOptions extends GlobalCliOptions {
  name: string
  platform: string
  ver: string
  username?: string
  extras?: string
  kind: string
  message: string
  stack?: string
}
