import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { inspectZip, extractZip, zipFolder, hashFile } from '../electron/archives';
test('backup restores world bytes, removes AuthKey and excludes executable files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-backup-'));
  try {
    const root = path.join(dir, 'root');
    await fs.mkdir(path.join(root, 'world'), { recursive: true });
    await fs.writeFile(path.join(root, 'world', 'level.dat'), Buffer.from([0, 1, 2, 3]));
    await fs.writeFile(
      path.join(root, 'ServerConfig.toml'),
      '[General]\nAuthKey="fixture-secret"\nName="Session"\n',
    );
    await fs.writeFile(path.join(root, 'server.jar'), 'excluded');
    const zip = path.join(dir, 'backup.zip');
    await zipFolder(root, zip);
    const entries = await inspectZip(zip);
    assert.ok(entries.some((e) => e.name === 'world/level.dat'));
    assert.ok(!entries.some((e) => e.name === 'server.jar'));
    const restored = path.join(dir, 'restored');
    await extractZip(zip, restored);
    assert.deepEqual(
      await fs.readFile(path.join(restored, 'world', 'level.dat')),
      Buffer.from([0, 1, 2, 3]),
    );
    assert.ok(
      !(await fs.readFile(path.join(restored, 'ServerConfig.toml'), 'utf8')).includes(
        'fixture-secret',
      ),
    );
    const hash = await hashFile(zip);
    await fs.appendFile(zip, 'changed');
    assert.notEqual(await hashFile(zip), hash);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('ZIP inspector refuses case-insensitive duplicate destinations', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-zip-'));
  try {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('a'), 'World/file');
    zip.addBuffer(Buffer.from('b'), 'world/FILE');
    const file = path.join(dir, 'duplicate.zip');
    const p = pipeline(zip.outputStream, createWriteStream(file));
    zip.end();
    await p;
    await assert.rejects(inspectZip(file), /Дублирующиеся/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('ZIP inspector rejects traversal even if a ZIP creator was bypassed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-malicious-'));
  try {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('payload'), 'xx/escape');
    const file = path.join(dir, 'bad.zip');
    const p = pipeline(zip.outputStream, createWriteStream(file));
    zip.end();
    await p;
    const bytes = await fs.readFile(file);
    for (let index = 0; (index = bytes.indexOf(Buffer.from('xx/escape'), index)) !== -1; index += 9)
      Buffer.from('../escape').copy(bytes, index);
    await fs.writeFile(file, bytes);
    await assert.rejects(inspectZip(file));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
