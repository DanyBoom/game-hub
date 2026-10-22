import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inflateSync } from 'node:zlib';
import { serverInput } from '../shared/contracts';
import { configure, readConfig } from '../electron/adapters';
import {
  readJson,
  patchIni,
  parseIni,
  encodeEvoDocument,
  configDocuments,
  saveConfigDocument,
} from '../electron/racing';
import { zipFolder, extractZip } from '../electron/archives';
const record = (game: 'assetto' | 'acc' | 'evo' | 'minecraft', root: string) =>
  ({
    ...serverInput.parse({
      game,
      name: 'Test server',
      port: 38000,
      players: 4,
      track: game === 'evo' ? 'Brands Hatch' : 'monza',
      cars: ['bmw_m3_e30'],
    }),
    id: 'fixture',
    root,
    createdAt: '',
    hasSecret: false,
    installed: false,
    status: 'stopped',
  }) as const;
test('AC INI preserves unknown parameters and creates a grid matching selected cars', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-ac-'));
  try {
    await fs.mkdir(path.join(root, 'cfg'));
    await fs.writeFile(
      path.join(root, 'cfg/server_cfg.ini'),
      '[SERVER]\nCUSTOM_PARAMETER=123\n[PLUGIN]\nUnknown=yes\n',
    );
    const s = record('assetto', root);
    await configure(s, '', { password: 'fixture-password' });
    const ini = parseIni(await fs.readFile(path.join(root, 'cfg/server_cfg.ini'), 'utf8'));
    assert.equal(ini.SERVER.CUSTOM_PARAMETER, '123');
    assert.equal(ini.PLUGIN.Unknown, 'yes');
    assert.equal(ini.SERVER.PASSWORD, 'fixture-password');
    const grid = parseIni(await fs.readFile(path.join(root, 'cfg/entry_list.ini'), 'utf8'));
    assert.equal(Object.keys(grid).filter((k) => k.startsWith('CAR_')).length, 4);
    assert.equal(grid.CAR_0.MODEL, 'bmw_m3_e30');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('ACC writes UTF16 JSON, real sessions, pit rules, entry list and BoP', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-acc-'));
  try {
    const s = record('acc', root);
    await configure(s, '', { adminPassword: 'fixture-admin' });
    const bytes = await fs.readFile(path.join(root, 'cfg/event.json'));
    assert.deepEqual([...bytes.subarray(0, 2)], [255, 254]);
    const event = await readJson(path.join(root, 'cfg/event.json'));
    assert.deepEqual(
      event.sessions.map((s: any) => s.sessionType),
      ['P', 'Q', 'R'],
    );
    assert.equal(event.track, 'monza');
    assert.ok((await configDocuments(s)).some((d) => d.name === 'cfg/bop.json'));
    const documents = await configDocuments(s);
    assert.ok(!JSON.stringify(documents).includes('fixture-admin'));
    const settings = documents.find((d) => d.name === 'cfg/settings.json')!;
    settings.data.serverName = 'Changed in forms';
    await saveConfigDocument(s, settings.name, settings.data);
    assert.equal((await readJson(path.join(root, settings.name))).adminPassword, 'fixture-admin');
    assert.equal((await readConfig(s)).name, 'Changed in forms');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('EVO encoding has the native length-prefix and a valid independent JSON config', async () => {
  const value = { server_name: 'Сессия', max_players: 8 };
  const bytes = Buffer.from(encodeEvoDocument(value), 'base64'),
    json = inflateSync(bytes.subarray(4));
  assert.equal(bytes.readUInt32BE(), json.length);
  assert.deepEqual(JSON.parse(json.toString()), value);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-evo-'));
  try {
    const s = record('evo', root);
    await configure(s, '');
    const server = await readJson(path.join(root, 'server_config.json'));
    assert.equal(server.server_tcp_listener_port, 38000);
    assert.equal(server.type, 'MultiplayerServerListSessionType_UNRANKED');
    const season = await readJson(path.join(root, 'season_config.json'));
    assert.equal(season.game_type, 'GameModeType_RACE_WEEKEND');
    assert.equal(season.game_config.practice_duration, 600);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('Minecraft writes seed, generator, view/simulation distance and world rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-mc-'));
  try {
    const s = {
      ...record('minecraft', root),
      seed: '123456789',
      viewDistance: 12,
      simulationDistance: 8,
      hardcore: true,
      whitelist: true,
    };
    await configure(s, '');
    const props = await fs.readFile(path.join(root, 'server.properties'), 'utf8');
    for (const line of [
      'level-seed=123456789',
      'view-distance=12',
      'simulation-distance=8',
      'hardcore=true',
      'white-list=true',
    ])
      assert.ok(props.includes(line));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('racing backups remove passwords from JSON and INI but preserve plugin JARs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-private-backup-'));
  try {
    const root = path.join(dir, 'source');
    await fs.mkdir(root);
    const s = record('acc', root);
    await configure(s, '', {
      password: 'fixture-player-secret',
      adminPassword: 'fixture-admin-secret',
    });
    await fs.mkdir(path.join(root, 'plugins'));
    await fs.writeFile(path.join(root, 'plugins/example.jar'), 'fixture-jar');
    await zipFolder(root, path.join(dir, 'backup.zip'));
    const target = path.join(dir, 'restored');
    await extractZip(path.join(dir, 'backup.zip'), target);
    const settings = await readJson(path.join(target, 'cfg/settings.json'));
    assert.equal(settings.password, '');
    assert.equal(settings.adminPassword, '');
    assert.equal(
      await fs.readFile(path.join(target, 'plugins/example.jar'), 'utf8'),
      'fixture-jar',
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('new cores and EVO track names are accepted while secrets cannot inject INI lines', () => {
  for (const core of ['fabric', 'forge', 'neoforge'])
    assert.ok(
      serverInput.safeParse({ game: 'minecraft', core, name: 'Test', port: 25565, players: 8 })
        .success,
    );
  assert.ok(
    serverInput.safeParse({
      game: 'evo',
      track: 'Brands Hatch',
      name: 'Test',
      port: 9700,
      players: 8,
    }).success,
  );
  assert.ok(
    !serverInput.safeParse({
      game: 'assetto',
      name: 'Test',
      port: 9600,
      players: 8,
      password: 'x\nKEY=unsafe',
    }).success,
  );
});
test('Minecraft full editor updates duplicate properties and keeps player files as JSON arrays', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-editor-'));
  try {
    const s = record('minecraft', root);
    await configure(s, '');
    await fs.appendFile(path.join(root, 'server.properties'), '\nview-distance=3\n');
    const documents = await configDocuments(s);
    const properties = documents.find((d) => d.name === 'server.properties')!;
    properties.data['view-distance'] = '12';
    await saveConfigDocument(s, properties.name, properties.data);
    const text = await fs.readFile(path.join(root, 'server.properties'), 'utf8');
    assert.equal(text.match(/view-distance=12/g)?.length, 2);
    const ops = documents.find((d) => d.name === 'ops.json')!;
    ops.data.entries = [{ uuid: 'fixture', name: 'Fixture', level: 4, bypassesPlayerLimit: false }];
    await saveConfigDocument(s, ops.name, ops.data);
    assert.ok(Array.isArray(await readJson(path.join(root, 'ops.json'))));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
