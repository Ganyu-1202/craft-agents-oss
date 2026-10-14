import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dir, '..');
const directory = await mkdtemp(join(tmpdir(), 'tokenbird-image-upload-'));
try {
  const build = await Bun.build({
    entrypoints: [join(root, 'apps/electron/src/renderer/utils/image-upload.browser.ts')],
    outdir: directory, target: 'browser', tsconfig: join(root, 'apps/electron/tsconfig.json'),
  });
  if (!build.success) throw new AggregateError(build.logs, 'Failed to bundle image upload checks');
  await writeFile(join(directory, 'index.html'), '<!doctype html><html><body><script type="module" src="image-upload.browser.js"></script></body></html>');
  await writeFile(join(directory, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  await win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
  const result=await win.webContents.executeJavaScript('window.runImageUploadChecks().then(checks=>({checks}),error=>({error:error.stack||String(error)}))');
  if(result.error)throw new Error(result.error);
  console.log(JSON.stringify({passed:result.checks.length,checks:result.checks}));app.exit(0);
}).catch(error=>{console.error(error.stack||error);app.exit(1)});
`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
  const child = spawn(executable, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: 'inherit' });
  const timeout = setTimeout(() => { child.kill(); console.error('Image upload checks timed out'); }, 60_000);
  process.exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1));
  }).finally(() => clearTimeout(timeout));
} finally { await rm(directory, { recursive: true, force: true }); }
