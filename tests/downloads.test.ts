import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustedUrl } from '../electron/downloads';
test('installer rejects HTTP, untrusted metadata hosts and credentials in download URLs', () => {
  for (const url of [
    'http://piston-data.mojang.com/server.jar',
    'https://example.org/server.jar',
    'https://user:password' + '@' + 'github.com/file',
  ])
    assert.throws(() => trustedUrl(url));
  assert.equal(
    trustedUrl('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'),
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  );
});
