import { build } from 'esbuild';
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
