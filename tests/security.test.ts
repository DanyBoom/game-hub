import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inside, redact, rejectLinks } from '../electron/security';
import { serverInput } from '../shared/contracts';
import { beamConfig, propertiesPatch } from '../electron/adapters';
import TOML from '@iarna/toml';
test('paths reject traversal, Windows ADS, reserved devices and ambiguous trailing characters', () => {
  const root = path.join(os.tmpdir(), 'gamehub-test');
  for (const bad of [
    '../private',
    'a/../../x',
    'C:\\private',
    '/absolute',
    'a:secret',
    'a/CON.txt',
    'a/NUL',
    'a/b.',
    'a/b ',
    'a\\..\\x',
    'a\0b',
  ])
    assert.throws(() => inside(root, bad), bad);
  assert.equal(
    inside(root, 'Resources/Client/car.zip'),
    path.join(root, 'Resources', 'Client', 'car.zip'),
  );
});
test('redaction covers exact secrets, config secrets, local profile paths and IP addresses', () => {
  const value = redact(
    'key=fixture-secret AuthKey="private-value" password=private 192.168.2.3 C:\\Users\\FixtureUser\\secret',
    ['fixture-secret'],
  );
  for (const text of [
    'fixture-secret',
    'private-value',
    'password=private',
    '192.168.2.3',
    'FixtureUser',
  ])
    assert.ok(!value.includes(text));
});
test('input forbids multiline configuration and arbitrary additional launch arguments', () => {
  const base = { game: 'beammp', name: 'Session', port: 30814, players: 8 };
  assert.ok(serverInput.safeParse(base).success);
  assert.ok(!serverInput.safeParse({ ...base, name: 'name\nAuthKey=x' }).success);
  assert.ok(!serverInput.safeParse({ ...base, port: 70000 }).success);
  assert.ok(!serverInput.safeParse({ ...base, args: ['--execute'] }).success);
  assert.ok(!serverInput.safeParse({ ...base, authKey: 'x\nName=unsafe' }).success);
  assert.ok(!serverInput.safeParse({ ...base, world: '../world' }).success);
});
test('BeamMP update preserves unknown sections and writes documented resource directory', () => {
  const s = {
    ...serverInput.parse({ game: 'beammp', name: 'Русская сессия', port: 30814, players: 8 }),
    id: 'fixture',
  } as any;
  const result = TOML.parse(
    beamConfig('[General]\nCustom = 42\n[Plugin]\nEnabled = true\n', s, 'fixture-key'),
  ) as any;
  assert.equal(result.General.Custom, 42);
  assert.equal(result.Plugin.Enabled, true);
  assert.equal(result.General.ResourceFolder, 'Resources');
  assert.equal(result.General.AuthKey, 'fixture-key');
  assert.equal(result.General.Name, s.name);
});
test('properties editor preserves unknown settings and updates every duplicate managed key', () => {
  const result = propertiesPatch('# comment\nunknown=value\nserver-port=1\nserver-port=2', {
    'server-port': '25565',
    'max-players': '12',
  });
  assert.match(result, /# comment/);
  assert.match(result, /unknown=value/);
  assert.equal(result.match(/server-port=25565/g)?.length, 2);
  assert.match(result, /max-players=12/);
});
test('junctions are rejected before file operations', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-path-'));
  try {
    await fs.mkdir(path.join(dir, 'outside'));
    await fs.mkdir(path.join(dir, 'root'));
    await fs.symlink(path.join(dir, 'outside'), path.join(dir, 'root', 'link'), 'junction');
    await assert.rejects(
      rejectLinks(path.join(dir, 'root'), path.join(dir, 'root', 'link', 'test')),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
