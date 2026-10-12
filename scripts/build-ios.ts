#!/usr/bin/env bun
/** Universal iPhone/iPad builds. Asset preparation also works on Windows/Linux. */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dir, '..')
const ios = join(root, 'apps/ios')
const output = join(root, 'dist/ios')
const args = new Set(process.argv.slice(2))
const allowed = new Set(['--help', '-h', '--prepare-only', '--simulator', '--release', '--export', '--skip-webui'])

function run(command: string, commandArgs: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`)))
  })
}

function removeGenerated(path: string, parent: string) {
  const rel = relative(parent, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Output is outside its expected directory: ${path}`)
  rmSync(path, { recursive: true, force: true })
}

async function prepare() {
  if (!args.has('--skip-webui')) await run(process.execPath, ['run', 'webui:build'])
  const source = join(root, 'apps/webui/dist')
  if (!existsSync(join(source, 'index.html'))) throw new Error('WebUI is missing; run bun run webui:build first.')
  const destination = join(ios, 'TokenBird/WebUI')
  removeGenerated(destination, ios)
  cpSync(source, destination, { recursive: true })
  // Source maps contain development sources and are not needed in a release app.
  function removeMaps(directory: string) {
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, file.name)
      if (file.isDirectory()) removeMaps(path)
      else if (file.name.endsWith('.map')) rmSync(path)
    }
  }
  removeMaps(destination)
  // Use the existing brand asset and installed Sharp; do not add a second logo.
  const sharpPath = Bun.resolveSync('sharp', join(root, 'apps/electron'))
  const { default: sharp } = await import(sharpPath)
  await sharp(join(root, 'apps/webui/src/public/icon-512.png'))
    .resize(1024, 1024).flatten({ background: '#ffffff' }).png()
    .toFile(join(ios, 'TokenBird/Assets.xcassets/AppIcon.appiconset/AppIcon.png'))
  console.log(`Prepared iPhone/iPad assets: ${destination}`)
}

async function checksums() {
  const lines: string[] = []
  for (const file of readdirSync(output).sort()) {
    if (!/\.(zip|ipa)$/.test(file)) continue
    const hash = createHash('sha256')
    for await (const chunk of Bun.file(join(output, file)).stream()) hash.update(chunk)
    lines.push(`${hash.digest('hex')}  ${file}`)
  }
  writeFileSync(join(output, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`)
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    console.log(`Usage: bun run ios:build [--prepare-only | --simulator | --release [--export]] [--skip-webui]
  Default: unsigned universal device .app.zip and .ipa for local sideload signing
  --simulator: unsigned simulator .app.zip
  --release: signed .xcarchive.zip (requires IOS_DEVELOPMENT_TEAM)
  --export: also export .ipa (requires IOS_EXPORT_OPTIONS_PLIST)
  --prepare-only: bundle WebUI and app icon without Xcode
  Optional: IOS_BUNDLE_IDENTIFIER, IOS_BUILD_NUMBER (1-9999; default 1), IOS_ALLOW_PROVISIONING_UPDATES=1`)
    return
  }
  for (const arg of args) if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`)
  if (args.has('--simulator') && args.has('--release')) throw new Error('--simulator and --release cannot be combined.')
  if (args.has('--prepare-only') && (args.has('--simulator') || args.has('--release') || args.has('--export'))) {
    throw new Error('--prepare-only cannot be combined with native build options.')
  }
  if (args.has('--export') && !args.has('--release')) throw new Error('--export requires --release.')
  if (!args.has('--prepare-only')) {
    if (process.platform !== 'darwin') throw new Error('Native iOS/iPadOS compilation requires macOS and Xcode. Use bun run ios:prepare on Windows/Linux.')
    await run('xcodebuild', ['-version'])
  }
  const team = process.env.IOS_DEVELOPMENT_TEAM
  const exportPlist = process.env.IOS_EXPORT_OPTIONS_PLIST
  if (args.has('--release') && !team) throw new Error('Signed archives require IOS_DEVELOPMENT_TEAM and an installed signing certificate/provisioning profile.')
  if (args.has('--export') && (!exportPlist || !existsSync(resolve(exportPlist)))) throw new Error('Set IOS_EXPORT_OPTIONS_PLIST to an existing Xcode export options plist.')
  await prepare()
  if (args.has('--prepare-only')) return

  const version = (await Bun.file(join(root, 'package.json')).json()).version as string
  const buildNumber = process.env.IOS_BUILD_NUMBER ?? '1'
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid iOS version: ${version}`)
  if (!/^[1-9]\d{0,3}$/.test(buildNumber)) throw new Error('IOS_BUILD_NUMBER must be an integer from 1 to 9999.')
  const simulator = args.has('--simulator')
  const release = args.has('--release')
  const variant = release ? 'archive' : simulator ? 'simulator' : 'device'
  const work = join(ios, 'build', `${Date.now()}-${process.pid}`)
  mkdirSync(output, { recursive: true })
  const xcodeArgs = ['-project', join(ios, 'TokenBird.xcodeproj'), '-scheme', 'TokenBird',
    '-sdk', simulator ? 'iphonesimulator' : 'iphoneos',
    '-configuration', release ? 'Release' : 'Debug', '-destination', simulator ? 'generic/platform=iOS Simulator' : 'generic/platform=iOS',
    '-derivedDataPath', join(work, 'DerivedData'), `MARKETING_VERSION=${version}`, `CURRENT_PROJECT_VERSION=${buildNumber}`,
    `PRODUCT_BUNDLE_IDENTIFIER=${process.env.IOS_BUNDLE_IDENTIFIER ?? 'top.goldgom.tokenbird'}`]
  if (release) {
    xcodeArgs.push(`DEVELOPMENT_TEAM=${team}`)
    if (process.env.IOS_ALLOW_PROVISIONING_UPDATES === '1') xcodeArgs.push('-allowProvisioningUpdates')
    xcodeArgs.push('-archivePath', join(work, 'TokenBird.xcarchive'), 'archive')
  } else { xcodeArgs.push('CODE_SIGNING_ALLOWED=NO', 'build') }
  await run('xcodebuild', xcodeArgs)
  const source = release ? join(work, 'TokenBird.xcarchive')
    : join(work, 'DerivedData/Build/Products', simulator ? 'Debug-iphonesimulator' : 'Debug-iphoneos', 'TokenBird.app')
  if (!existsSync(source)) throw new Error(`Xcode build completed without ${source}`)
  const archiveName = `TokenBird-${version}-ios-${variant}${release ? '.xcarchive' : '.app'}.zip`
  const archiveOutput = join(output, archiveName)
  if (existsSync(archiveOutput)) rmSync(archiveOutput)
  await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, archiveOutput])
  if (!release && !simulator) {
    const payload = join(work, 'unsigned-ipa/Payload')
    mkdirSync(payload, { recursive: true })
    cpSync(source, join(payload, 'TokenBird.app'), { recursive: true })
    const unsignedIpa = join(output, `TokenBird-${version}-ios-device-unsigned.ipa`)
    if (existsSync(unsignedIpa)) rmSync(unsignedIpa)
    await run('ditto', ['-c', '-k', '--keepParent', payload, unsignedIpa])
  }
  if (args.has('--export')) {
    const exportDirectory = join(work, 'export')
    await run('xcodebuild', ['-exportArchive', '-archivePath', source, '-exportPath', exportDirectory,
      '-exportOptionsPlist', resolve(exportPlist!), ...(process.env.IOS_ALLOW_PROVISIONING_UPDATES === '1' ? ['-allowProvisioningUpdates'] : [])])
    const ipa = readdirSync(exportDirectory).find(file => file.endsWith('.ipa'))
    if (!ipa) throw new Error('Xcode export completed without an IPA.')
    cpSync(join(exportDirectory, ipa), join(output, `TokenBird-${version}-ios.ipa`))
  }
  await checksums()
  console.log(`iPhone/iPad ${variant} build completed: ${output}`)
}

if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
