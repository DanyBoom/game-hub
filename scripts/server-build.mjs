import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
await mkdir('dist-server', { recursive: true });
await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  outfile: 'dist-server/server.cjs',
  external: ['sql.js', 'selfsigned'],
  plugins: [
    {
      name: 'server-platform',
      setup(b) {
        b.onResolve({ filter: /^\.\/platform$/ }, (args) =>
          args.importer.includes(path.sep + 'electron' + path.sep)
            ? { path: path.resolve('server/platform.ts') }
            : undefined,
        );
      },
    },
  ],
});
await build({
  entryPoints: ['electron/runner.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  outfile: 'dist-server/runner.cjs',
});
await copyFile('node_modules/sql.js/dist/sql-wasm.wasm', 'dist-server/sql-wasm.wasm');
await copyFile('dist-server/web/web/index.html', 'dist-server/web/index.html');
if (process.platform === 'win32')
  execFileSync(
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/optimize+',
      '/debug-',
      '/out:' + path.resolve('dist-server/ConsoleHost.exe'),
      path.resolve('native/ConsoleHost.cs'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
