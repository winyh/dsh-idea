import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import * as webFetchHttp from '@deepseek-ai/dsh-web-fetch-http'
import type {} from '@deepseek-ai/dsh-web'
import { IdeaDiscoveryService } from './service.js'
import { registerIdeaTools } from './tools.js'
import type { FileSystemLike, IdeaConfig } from './types.js'
import type { WebLike } from './web.js'

export const name = 'dsh-idea'
export const inject = ['tools', 'fs', 'web']

export type Config = IdeaConfig

export const Config: Schema<IdeaConfig> = Schema.object({
  defaultRoot: Schema.string().default('.'),
  reportDir: Schema.string().default('.dsh-idea/reports'),
  maxFiles: Schema.number().step(1).min(1).max(5_000).default(500),
  maxRows: Schema.number().step(1).min(1).max(500_000).default(50_000),
  maxFileBytes: Schema.number().step(1).min(1_024).max(10_485_760).default(1_048_576),
  maxTextChars: Schema.number().step(1).min(1_000).max(1_000_000).default(180_000),
  maxResultChars: Schema.number().step(1).min(1_000).max(200_000).default(50_000),
  defaultLanguage: Schema.string().default('zh-CN'),
  defaultSort: Schema.union([
    Schema.const('latest'),
    Schema.const('repeat'),
    Schema.const('pain'),
    Schema.const('verifiable'),
  ]).default('verifiable'),
  maxExternalUrls: Schema.number().step(1).min(1).max(20).default(5),
  maxExternalChars: Schema.number().step(1).min(1_000).max(100_000).default(30_000),
  requestTimeoutMs: Schema.number().step(1).min(1_000).max(120_000).default(30_000),
})

export function apply(ctx: Context, config: IdeaConfig): void {
  const fs = (ctx as unknown as { fs: FileSystemLike }).fs
  if (!ctx.registry.has(webFetchHttp)) {
    void ctx.plugin(webFetchHttp, {
      maxBodyChars: config.maxExternalChars,
      maxResponseBytes: 5_000_000,
      timeoutMs: config.requestTimeoutMs,
      maxRedirects: 5,
    })
  }
  const service = new IdeaDiscoveryService(ctx, fs, config)
  const web = (ctx as unknown as { web: WebLike }).web
  registerIdeaTools(ctx, config, service, fs, web)
  console.log(`[${name}] registered idea-discovery tools for ${config.defaultRoot}`)
}
