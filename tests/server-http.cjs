// End-to-end HTTPS checks against the built panel. All data and credentials are ephemeral.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path'),
  https = require('node:https'),
  { spawn } = require('node:child_process'),
  { once } = require('node:events');
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'gamehub-http-'));
  const child = spawn(
    process.execPath,
    ['dist-server/server.cjs', '--data', data, '--host', '127.0.0.1', '--port', 'auto'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '',
    errors = '';
  child.stdout.on('data', (c) => (output += c));
  child.stderr.on('data', (c) => (errors += c));
  let port, password, ca;
  async function req(url, value, headers = {}) {
    const raw = value === undefined ? undefined : JSON.stringify(value);
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          hostname: '127.0.0.1',
          port,
          path: url,
          method: raw === undefined ? 'GET' : 'POST',
          ca,
          headers: { 'Content-Type': 'application/json', ...headers },
        },
        (response) => {
          let text = '';
          response.on('data', (c) => (text += c));
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              text,
              json: () => JSON.parse(text),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end(raw);
    });
  }
  try {
    for (let i = 0; i < 200; i++) {
      if (/GameHub HTTPS port: (\d+)/.test(output)) break;
      if (child.exitCode !== null) throw new Error('Server failed: ' + errors);
      await new Promise((r) => setTimeout(r, 100));
    }
    port = Number(/GameHub HTTPS port: (\d+)/.exec(output)?.[1]);
    password = /GameHub password: (\S+)/.exec(output)?.[1];
    assert.ok(port && password, 'server bootstrap');
    ca = await fs.readFile(path.join(data, 'tls-cert.pem'));
    assert.equal((await req('/api/session')).status, 401);
    assert.equal((await req('/')).status, 200);
    assert.equal((await req('/api/login', { login: 'admin', password: 'wrong' })).status, 401);
    const login = await req('/api/login', { login: 'admin', password });
    assert.equal(login.status, 200);
    assert.match(login.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Strict/);
    const cookie = login.headers['set-cookie'][0].split(';')[0],
      csrf = login.json().data.csrf,
      h = { Cookie: cookie, 'X-GameHub-CSRF': csrf };
    assert.equal(
      (await req('/api/action', { action: 'snapshot' }, { Cookie: cookie })).status,
      403,
    );
    assert.equal(
      (
        await req(
          '/api/action',
          { action: 'snapshot' },
          { ...h, Origin: 'https://untrusted.example.org' },
        )
      ).status,
      403,
    );
    async function call(action, payload) {
      const response = await req('/api/action', { action, payload }, h);
      const result = response.json();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    }
    const available = await call('freePort');
    assert.ok(Number.isInteger(available) && available >= 1024 && available <= 65535);
    const snapshot = await call('snapshot');
    assert.equal(snapshot.version, '0.4.0');
    assert.ok(snapshot.games.some((g) => g.id === 'terraria'));
    const s = await call('create', {
      game: 'beammp',
      name: 'Fixture',
      port: 30814,
      players: 4,
      authKey: 'fixture-key',
    });
    assert.ok(s.id);
    assert.equal(s.authKey, undefined);
    assert.ok(!(await call('snapshot')).servers[0].authKey);
    const docs = await call('configDocuments', s.id);
    assert.ok(!JSON.stringify(docs).includes('fixture-key'));
    assert.equal(
      (await req('/api/action', { action: 'openFolder', payload: '../../' }, h)).status,
      400,
    );
    assert.equal((await req('/api/upload?id=' + s.id + '&name=../escape.zip', {}, h)).status, 400);
    if (process.env.GAMEHUB_TEST_GAMES) {
      for (const [index, game] of process.env.GAMEHUB_TEST_GAMES.split(',').entries()) {
        const server = await call('create', {
          game,
          name: 'Runtime ' + game,
          port: 38640 + index * 10,
          players: 4,
          password: 'fixture-only-password',
          world: 'fixture',
          worldSize: 1,
          ...(game === 'nightcoop'
            ? { nightcoop: { shards: 3, address: 'localhost', statsSeconds: 1 } }
            : {}),
        });
        console.log(game + ': install requested');
        await call('install', server.id);
        console.log(game + ': official installation completed');
        if (game === 'beammp') continue;
        await call('start', server.id);
        let ready = false;
        for (let i = 0; i < 120; i++) {
          const logs = await call('logs', server.id);
          if (
            logs.some((l) =>
              /Server started|Hosting game|Creating game|Game server connected|Listening on port|NightCoop hub on port/.test(
                l.text,
              ),
            )
          ) {
            ready = true;
            break;
          }
          const snapshot = await call('snapshot');
          if (snapshot.servers.find((s) => s.id === server.id).status === 'error')
            throw new Error(
              game +
                ': ' +
                logs
                  .slice(-6)
                  .map((l) => l.text)
                  .join(' | '),
            );
          await new Promise((r) => setTimeout(r, 1000));
        }
        assert.ok(ready, game + ' readiness');
        await call('stop', server.id);
        if (game === 'nightcoop') {
          const info = await call('nightcoopInfo', server.id);
          assert.match(info.fingerprint, /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/);
          assert.deepEqual(info.ports, [server.port, server.port + 10, server.port + 11]);
          const keyFile = path.join(server.root, 'hub-sign.key');
          const key = await fs.readFile(keyFile, 'utf8');
          assert.equal((await fs.stat(keyFile)).mode & 0o777, 0o600);
          assert.ok(!JSON.stringify(info).includes(key.trim()));
          assert.ok(
            !(await fs.readFile(path.join(data, 'gamehub.sqlite'))).includes(
              Buffer.from(key.trim()),
            ),
          );
          const locations = Buffer.from(
            'serial 1\n- open home localhost#' + info.fingerprint + ' Fixture\n',
          ).toString('base64');
          await call('nightcoopFile', { id: server.id, name: 'locations.txt', base64: locations });
          await assert.rejects(
            call('nightcoopFile', {
              id: server.id,
              name: 'hub.cert',
              base64: Buffer.from('invalid').toString('base64'),
            }),
          );
          const backup = await call('backup', server.id);
          await call('restore', { id: server.id, backupId: backup.id });
          // Binary is intentionally excluded, while the protected profile restores the same identity.
          assert.equal(await fs.readFile(keyFile, 'utf8'), key);
          await call('install', server.id);
          assert.equal((await call('nightcoopInfo', server.id)).fingerprint, info.fingerprint);
          await call('start', server.id);
          await new Promise((r) => setTimeout(r, 1500));
          await call('stop', server.id);
          console.log(
            'nightcoop: public identity, private key, upload validation and restore verified',
          );
        }
        console.log(game + ': start and saving stop completed');
      }
    }
    await req('/api/logout', {}, h);
    assert.equal((await req('/api/session', undefined, { Cookie: cookie })).status, 401);
    console.log(
      JSON.stringify({
        https: true,
        automaticPort: true,
        login: true,
        secureCookie: true,
        csrf: true,
        originCheck: true,
        secretsHidden: true,
        traversalRejected: true,
        logout: true,
      }),
    );
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit').catch(() => {}),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    if (child.exitCode === null) child.kill();
    await fs.rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
