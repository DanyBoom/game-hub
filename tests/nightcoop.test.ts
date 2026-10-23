import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serverInput, type ServerRecord } from '../shared/contracts';
import { nightcoopArgs, nightcoopPorts } from '../electron/nightcoop';
import { zipFolder, inspectZip } from '../electron/archives';

test('NightCoop ports follow the upstream shard protocol and reject overflow', () => {
  const s = serverInput.parse({
    game: 'nightcoop',
    name: 'Fixture',
    players: 8,
    port: 47800,
    nightcoop: { shards: 4 },
  });
  assert.deepEqual(nightcoopPorts(s), [47800, 47810, 47811, 47812]);
  assert.deepEqual(
    nightcoopPorts({ ...s, nightcoop: { ...s.nightcoop, shards: 'auto' } }, 2),
    [47800, 47810],
  );
  assert.throws(() => nightcoopPorts({ ...s, port: 65530 }));
  assert.equal(
    serverInput.safeParse({ ...s, nightcoop: { ...s.nightcoop, shards: 65 } }).success,
    false,
  );
  assert.equal(
    serverInput.safeParse({ ...s, nightcoop: { ...s.nightcoop, address: '--sign-key /tmp/key' } })
      .success,
    false,
  );
});
test('NightCoop arguments keep quiet default stats and fixed secret/public paths', () => {
  const s = {
    ...serverInput.parse({ game: 'nightcoop', name: 'Fixture', players: 8, port: 47800 }),
    root: path.resolve('fixture'),
  } as ServerRecord;
  const args = nightcoopArgs(s);
  assert.ok(!args.includes('--stats'));
  assert.equal(args[args.indexOf('--sign-key') + 1], path.join(s.root, 'hub-sign.key'));
  const custom = nightcoopArgs({
    ...s,
    nightcoop: {
      ...s.nightcoop,
      statsSeconds: 10,
      guard: false,
      hubNames: ['hub.example.org'],
      useLocations: true,
    },
  });
  assert.equal(custom[custom.indexOf('--stats') + 1], '10');
  assert.equal(custom[custom.indexOf('--guard') + 1], 'off');
  assert.equal(custom[custom.indexOf('--locations') + 1], path.join(s.root, 'locations.txt'));
});
test('NightCoop backup excludes signing key, binary and temporary build sources', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-nightcoop-'));
  try {
    const root = path.join(dir, 'hub');
    await fs.mkdir(path.join(root, '.nightcoop-build-fixture'), { recursive: true });
    for (const name of [
      'hub-sign.key',
      'nightcoop_hub',
      'nightcoop.json',
      '.nightcoop-build-fixture/source.cpp',
    ])
      await fs.writeFile(path.join(root, name), 'fixture');
    const zip = path.join(dir, 'backup.zip');
    await zipFolder(root, zip);
    assert.deepEqual(
      (await inspectZip(zip)).map((e) => e.name),
      ['nightcoop.json'],
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
