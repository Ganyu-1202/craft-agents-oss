import type { BunPlugin } from 'bun';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Clipboard access belongs to the host UI, never the JSONL subprocess.
 * The SDK's optional native addon can hang Bun during import when absent in
 * an installed/staged runtime, before the server can accept init messages. */
export function headlessRuntimePlugin(): { plugin: BunPlugin; assertApplied: () => void } {
  let applied = false;
  let photonApplied = false;
  return {
    plugin: {
      name: 'pi-headless-runtime',
      setup(build) {
        // Photon loads WASM beside its original package via __dirname. Embed it
        // so installed single-file subprocesses can downscale history images.
        build.onLoad({ filter: /[/\\]photon-node[/\\]photon_rs\.js$/ }, ({ path }) => {
          const source = readFileSync(path, 'utf8');
          const read = "const bytes = require('fs').readFileSync(path);";
          if (!source.includes(read)) throw new Error('Photon WASM loader changed; update the packaged image runtime');
          photonApplied = true;
          const wasm = readFileSync(join(dirname(path), 'photon_rs_bg.wasm')).toString('base64');
          return { contents: source.replace(read, `const bytes = Buffer.from('${wasm}', 'base64');`), loader: 'js' };
        });
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
      if (!photonApplied) throw new Error('Packaged image WASM was not embedded; check the Pi SDK image runtime');
    },
  };
}
