import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../electron/store';
import { serverInput } from '../shared/contracts';
test('SQLite persists server settings and parameters safely across reload', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-store-'));
  try {
    const file = path.join(folder, 'test.sqlite'),
      wasm = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');
    const first = new Store(file);
    await first.init(wasm);
    const record = {
      ...serverInput.parse({ game: 'beammp', name: "Quoted ' session", port: 30814, players: 8 }),
      id: 'fixture',
      root: 'fixture',
      status: 'stopped',
      hasSecret: false,
      installed: false,
      createdAt: new Date().toISOString(),
    } as any;
    await first.put(record);
    await first.setting('test-key', "quote' and unicode: мир");
    const second = new Store(file);
    await second.init(wasm);
    assert.equal(second.all()[0].name, record.name);
    assert.equal(second.getSetting('test-key'), "quote' and unicode: мир");
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});
