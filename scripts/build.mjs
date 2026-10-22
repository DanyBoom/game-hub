import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
await build({
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist-electron/main.cjs',
  external: ['electron', 'sql.js'],
  sourcemap: false,
});
await build({
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist-electron/preload.cjs',
  external: ['electron'],
  sourcemap: false,
});
await build({
  entryPoints: ['electron/runner.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist-electron/runner.cjs',
  sourcemap: false,
});
if (process.platform === 'win32')
  execFileSync(
    path.join(
      process.env.WINDIR ?? 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    ),
    [
      '/nologo',
      '/target:exe',
      '/optimize+',
      '/debug-',
      '/out:' + path.resolve('dist-electron', 'ConsoleHost.exe'),
      path.resolve('native', 'ConsoleHost.cs'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
