import { cpSync, existsSync, readdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Mirror bundled resources so renamed commands/docs cannot survive in later builds. */
export function syncResourceDirectory(source: string, destination: string): void {
  const sourceRoot = realpathSync(source)
  const destinationRoot = resolve(destination)
  const sourceRelative = relative(destinationRoot, sourceRoot)
  const destinationRelative = relative(sourceRoot, destinationRoot)
  const within = (path: string) => path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  if (within(sourceRelative) || within(destinationRelative)) {
    throw new Error('Resource source and destination directories must not overlap')
  }

  if (existsSync(destinationRoot)) {
    const physicalRoot = realpathSync(destinationRoot)
    const prune = (sourcePath: string, destinationPath: string): void => {
      for (const entry of readdirSync(destinationPath, { withFileTypes: true })) {
        const target = join(destinationPath, entry.name)
        const parentRelative = relative(physicalRoot, realpathSync(dirname(target)))
        if (parentRelative === '..' || parentRelative.startsWith(`..${sep}`) || isAbsolute(parentRelative)) {
          throw new Error('Resource cleanup escaped the destination directory')
        }
        const currentSource = join(sourcePath, entry.name)
        if (entry.isSymbolicLink()) {
          // Never copy through a destination junction/symlink into another directory.
          unlinkSync(target)
        } else if (!existsSync(currentSource)) {
          rmSync(target, { recursive: entry.isDirectory(), force: true })
        } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
          prune(currentSource, target)
        }
      }
    }
    prune(sourceRoot, destinationRoot)
  }

  cpSync(sourceRoot, destinationRoot, { recursive: true, force: true })
}
