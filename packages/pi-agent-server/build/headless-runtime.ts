import type { BunPlugin } from 'bun';
import { readFileSync } from 'node:fs';

/** Clipboard access belongs to the host UI, never the JSONL subprocess.
 * The SDK's optional native addon can hang Bun during import when absent in
 * an installed/staged runtime, before the server can accept init messages. */
export function headlessRuntimePlugin(): { plugin: BunPlugin; assertApplied: () => void } {
  let applied = false;
  return {
    plugin: {
      name: 'pi-headless-runtime',
      setup(build) {
        build.onLoad({ filter: /[/\\]pi-coding-agent[/\\]dist[/\\]utils[/\\]clipboard-native\.js$/ }, () => {
          applied = true;
          return {
            contents: 'export const clipboard = null; export function loadClipboardNative() { return null; }',
            loader: 'js',
          };
        });
        // js-yaml hides this require from Browserify through a variable alias.
        // Make it visible to Bun so staged bundles include the parser instead
        // of attempting to resolve/install it during subprocess startup.
        build.onLoad({ filter: /[/\\]js-yaml[/\\]lib[/\\]js-yaml[/\\]type[/\\]js[/\\]function\.js$/ }, ({ path }) => ({
          contents: readFileSync(path, 'utf8').replace("_require('esprima')", "require('esprima')"),
          loader: 'js',
        }));
      },
    },
    assertApplied() {
      if (!applied) throw new Error('Headless clipboard shim was not applied; check the Pi SDK module path');
    },
  };
}
