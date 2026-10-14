#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTokenBirdAgentReadOnlyBashPatterns } from './cli-domains.ts'

interface AllowedBashEntry {
  pattern: string
  comment?: string
}

interface PermissionsConfig {
  version?: string
  allowedBashPatterns?: AllowedBashEntry[]
  [key: string]: unknown
}

function isTokenBirdAgentPattern(entry: AllowedBashEntry): boolean {
  return typeof entry.pattern === 'string' && entry.pattern.startsWith('^tokenbird\\s')
}

function syncTokenBirdAgentPatterns(config: PermissionsConfig): PermissionsConfig {
  const patterns = config.allowedBashPatterns ?? []
  const firstTokenBirdIndex = patterns.findIndex(isTokenBirdAgentPattern)

  const withoutTokenBird = patterns.filter(entry => !isTokenBirdAgentPattern(entry))
  const generated = getTokenBirdAgentReadOnlyBashPatterns()

  const insertAt = firstTokenBirdIndex >= 0 ? firstTokenBirdIndex : withoutTokenBird.length
  const nextAllowedBashPatterns = [
    ...withoutTokenBird.slice(0, insertAt),
    ...generated,
    ...withoutTokenBird.slice(insertAt),
  ]

  return {
    ...config,
    allowedBashPatterns: nextAllowedBashPatterns,
  }
}

function main() {
  const targetPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(process.cwd(), 'apps/electron/resources/permissions/default.json')

  const config = JSON.parse(readFileSync(targetPath, 'utf-8')) as PermissionsConfig
  const nextConfig = syncTokenBirdAgentPatterns(config)

  writeFileSync(targetPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8')
  process.stdout.write(`Synced tokenbird bash patterns in ${targetPath}\n`)
}

if (import.meta.main) {
  main()
}
