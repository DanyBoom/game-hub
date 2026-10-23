import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCredentials, Auth } from '../server/auth';
import { configurePlatform, safeStorage } from '../server/platform';
import { contentDetails, saveContentConfig } from '../electron/content-settings';
import { serverInput, type ServerRecord } from '../shared/contracts';
test('server stores a salted password hash, limits failed logins and invalidates logout', async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-auth-'));
  try {
    const credentials = await createCredentials(data);
    assert.ok(credentials);
    assert.equal(await createCredentials(data), null);
    const raw = await fs.readFile(path.join(data, 'credentials.json'), 'utf8');
    assert.ok(!raw.includes(credentials.password));
    const auth = await Auth.load(data);
    assert.equal(await auth.login('fixture', 'admin', 'wrong'), null);
    const session = await auth.login('fixture', 'admin', credentials.password);
    assert.ok(session);
    assert.ok(auth.session('gamehub=' + session.token));
    assert.equal(auth.session('gamehub=invalid'), null);
    auth.logout(session.token);
    assert.equal(auth.session('gamehub=' + session.token), null);
    for (let i = 0; i < 8; i++) await auth.login('other', 'admin', 'wrong');
    await assert.rejects(() => auth.login('other', 'admin', credentials.password));
  } finally {
    await fs.rm(data, { recursive: true, force: true });
  }
});
test('server AES-GCM rejects tampering and a different key', () => {
  configurePlatform('fixture', Buffer.alloc(32, 1));
  const encrypted = safeStorage.encryptString('fixture-private-value');
  assert.equal(safeStorage.decryptString(encrypted), 'fixture-private-value');
  encrypted[13] ^= 1;
  assert.throws(() => safeStorage.decryptString(encrypted));
  configurePlatform('fixture', Buffer.alloc(32, 2));
  assert.throws(() => safeStorage.decryptString(encrypted));
});
test('mod settings mask credentials, validate format and refuse arbitrary file access', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-mod-'));
  const s = {
    ...serverInput.parse({
      game: 'minecraft',
      name: 'Fixture',
      port: 30000,
      players: 4,
      core: 'fabric',
    }),
    root,
    id: 'fixture',
    createdAt: '',
    hasSecret: false,
    installed: false,
    status: 'stopped',
  } as ServerRecord;
  try {
    await fs.mkdir(path.join(root, 'mods'));
    await fs.writeFile(path.join(root, 'mods/fixture-1.0.jar'), 'fixture');
    await fs.mkdir(path.join(root, 'config'));
    await fs.writeFile(
      path.join(root, 'config/fixture.toml'),
      'amount=2\npassword="fixture-credential"\n',
    );
    const details = await contentDetails(
      s,
      'fixture-1.0.jar',
      path.join(root, 'mods/fixture-1.0.jar'),
    );
    assert.equal(details.configs.length, 1);
    assert.ok(!details.configs[0].text.includes('fixture-credential'));
    await saveContentConfig(
      s,
      details.name,
      path.join(root, 'mods/fixture-1.0.jar'),
      details.configs[0].name,
      details.configs[0].text.replace('amount=2', 'amount=3'),
    );
    assert.match(
      await fs.readFile(path.join(root, 'config/fixture.toml'), 'utf8'),
      /amount=3\npassword="fixture-credential"/,
    );
    await assert.rejects(() =>
      saveContentConfig(
        s,
        details.name,
        path.join(root, 'mods/fixture-1.0.jar'),
        'server.properties',
        'x=1',
      ),
    );
    await assert.rejects(() =>
      saveContentConfig(
        s,
        details.name,
        path.join(root, 'mods/fixture-1.0.jar'),
        details.configs[0].name,
        'amount=4',
      ),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
