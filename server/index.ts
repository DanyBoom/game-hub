import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { createReadStream, createWriteStream, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import selfsigned from 'selfsigned';
import { Store } from '../electron/store';
import { Manager } from '../electron/manager';
import { atomicWrite, inside, redact } from '../electron/security';
import { configurePlatform } from './platform';
import { Auth, createCredentials } from './auth';
import { dispatch } from './dispatch';
import { idSchema } from '../shared/contracts';

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2),
    arg = (key: string, fallback: string) => {
      const i = args.indexOf('--' + key);
      return i >= 0 ? args[i + 1] : fallback;
    };
  const data = path.resolve(arg('data', process.env.GAMEHUB_DATA ?? 'server-data'));
  await fs.mkdir(data, { recursive: true, mode: 0o700 });
  const stopFile = path.join(data, 'shutdown.request');
  if (args.includes('--shutdown')) {
    await atomicWrite(stopFile, String(Date.now()));
    console.log('Requested a saving shutdown.');
    return;
  }
  const lock = path.join(data, 'panel.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lock, 'wx', 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      process.once('exit', () => {
        try {
          unlinkSync(lock);
        } catch {}
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt) throw error;
      const previous = Number(await fs.readFile(lock, 'utf8'));
      let alive = true;
      try {
        process.kill(previous, 0);
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
      if (alive)
        throw new Error('Для этой папки данных уже работает GameHub. Сначала остановите его.');
      await fs.unlink(lock);
    }
  }
  await fs.rm(stopFile, { force: true });
  const credentials = await createCredentials(data, args.includes('--reset-password'));
  if (credentials)
    console.log(
      `GameHub login: ${credentials.login}\nGameHub password: ${credentials.password}\nKeep these credentials privately. Password is shown only now.`,
    );
  if (args.includes('--reset-password')) return;
  const keyFile = path.join(data, 'encryption.key');
  if (
    !(await fs
      .access(keyFile)
      .then(() => true)
      .catch(() => false))
  )
    await fs.writeFile(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
  configurePlatform(data, await fs.readFile(keyFile));
  const certFile = arg('tls-cert', path.join(data, 'tls-cert.pem')),
    keyPem = arg('tls-key', path.join(data, 'tls-key.pem'));
  if (
    !args.includes('--tls-cert') &&
    !(await fs
      .access(certFile)
      .then(() => true)
      .catch(() => false))
  ) {
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'GameHub' }], {
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ],
    });
    await atomicWrite(keyPem, pems.private);
    await atomicWrite(certFile, pems.cert);
  }
  const auth = await Auth.load(data),
    store = new Store(path.join(data, 'gamehub.sqlite'));
  await store.init(path.join(__dirname, 'sql-wasm.wasm'));
  await store.setting('root', path.join(data, 'servers'));
  const manager = new Manager(store, data, () => null as any);
  await manager.init();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
  const headers = {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
  const json = (res: import('node:http').ServerResponse, code: number, value: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  const body = async (req: import('node:http').IncomingMessage) => {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += c.length;
      if (size > 2 * 1024 ** 2) throw new Error('Запрос слишком большой');
      chunks.push(c);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const server = https.createServer(
    { cert: await fs.readFile(certFile), key: await fs.readFile(keyPem) },
    async (req, res) => {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      try {
        const url = new URL(req.url ?? '/', 'https://localhost');
        if (req.headers.origin && req.headers.origin !== `https://${req.headers.host}`)
          return json(res, 403, { ok: false, error: 'Недоверенный источник' });
        if (req.method === 'POST' && url.pathname === '/api/login') {
          const input = z
            .object({ login: z.string().max(100), password: z.string().max(200) })
            .strict()
            .parse(await body(req));
          const session = await auth.login(
            req.socket.remoteAddress ?? '',
            input.login,
            input.password,
          );
          if (!session) return json(res, 401, { ok: false, error: 'Неверный логин или пароль' });
          res.setHeader(
            'Set-Cookie',
            `gamehub=${session.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
          );
          return json(res, 200, { ok: true, data: { csrf: session.csrf } });
        }
        if (url.pathname.startsWith('/api/')) {
          const session = auth.session(req.headers.cookie);
          if (!session) return json(res, 401, { ok: false, error: 'Войдите в панель' });
          if (url.pathname === '/api/session' && req.method === 'GET')
            return json(res, 200, { ok: true, data: { csrf: session.csrf } });
          if (req.method !== 'POST' || req.headers['x-gamehub-csrf'] !== session.csrf)
            return json(res, 403, { ok: false, error: 'Проверка сессии не пройдена' });
          if (url.pathname === '/api/logout') {
            auth.logout(session.token);
            res.setHeader(
              'Set-Cookie',
              'gamehub=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
            );
            return json(res, 200, { ok: true });
          }
          if (url.pathname === '/api/upload') {
            const id = idSchema.parse(url.searchParams.get('id')),
              kind = z
                .enum(['auto', 'server', 'world', 'datapack'])
                .parse(url.searchParams.get('kind') ?? 'auto');
            manager.get(id);
            const name = url.searchParams.get('name') ?? '';
            if (
              name !== path.basename(name) ||
              !/^.{1,150}\.(zip|jar|lua)$/i.test(name) ||
              /[\\/:\x00]/.test(name)
            )
              throw new Error('Недопустимое имя файла');
            const upload = path.join(data, 'uploads', crypto.randomUUID());
            await fs.mkdir(upload, { recursive: true });
            const file = inside(upload, name);
            let size = 0;
            try {
              await pipeline(
                req,
                new Transform({
                  transform(chunk, _encoding, done) {
                    size += chunk.length;
                    done(size > 250 * 1024 ** 2 ? new Error('Лимит файла 250 МБ') : null, chunk);
                  },
                }),
                createWriteStream(file, { flags: 'wx', mode: 0o600 }),
              );
              const result = await serial(() => manager.dropped(id, [file], kind));
              return json(res, 200, { ok: true, data: result });
            } finally {
              await fs.rm(upload, { recursive: true, force: true });
            }
          }
          if (url.pathname === '/api/action') {
            const { action, payload } = z
              .object({ action: z.string().max(40), payload: z.unknown().optional() })
              .strict()
              .parse(await body(req));
            const read = [
              'snapshot',
              'logs',
              'content',
              'contentDetails',
              'gameOptions',
              'versions',
              'configDocuments',
              'diagnose',
              'backups',
            ];
            const run = () => dispatch(manager, action, payload);
            const result =
              read.includes(action) || ['cancelInstall', 'stop'].includes(action)
                ? await run()
                : await serial(run);
            return json(res, 200, { ok: true, data: result });
          }
          return json(res, 404, { ok: false, error: 'Неизвестный API' });
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false });
        const web = path.join(__dirname, 'web'),
          relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        if (!/^(index\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(relative))
          return json(res, 404, { ok: false });
        const file = inside(web, relative),
          stat = await fs.stat(file);
        if (!stat.isFile()) return json(res, 404, { ok: false });
        res.writeHead(200, {
          'Content-Type': file.endsWith('.js')
            ? 'text/javascript'
            : file.endsWith('.css')
              ? 'text/css'
              : 'text/html; charset=utf-8',
          'Content-Length': stat.size,
        });
        if (req.method === 'HEAD') res.end();
        else createReadStream(file).pipe(res);
      } catch (error) {
        if (!res.headersSent)
          json(res, 400, {
            ok: false,
            error:
              error instanceof z.ZodError
                ? 'Проверьте поля формы'
                : redact((error as Error).message),
          });
        else res.end();
      }
    },
  );
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  server.maxRequestsPerSocket = 1000;
  const rawPort = arg('port', 'auto'),
    port = rawPort === 'auto' ? 0 : z.coerce.number().int().min(1024).max(65535).parse(rawPort);
  const host = arg('host', '0.0.0.0');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address() as import('node:net').AddressInfo;
  await atomicWrite(path.join(data, 'panel.json'), JSON.stringify({ port: address.port, host }));
  console.log(
    `GameHub HTTPS port: ${address.port}\nURL: https://<server-address>:${address.port}\nCertificate SHA256: ${new crypto.X509Certificate(await fs.readFile(certFile)).fingerprint256}`,
  );
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await manager.cancelAllInstalls();
    await Promise.all([...manager.running.keys()].map((id) => manager.stop(id)));
    process.exit(0);
  };
  const maintenance = setInterval(
    () =>
      void fs
        .access(stopFile)
        .then(() => close())
        .catch(() => {}),
    1000,
  );
  maintenance.unref();
  process.on('SIGTERM', () => void close().catch(() => (process.exitCode = 1)));
  process.on('SIGINT', () => void close().catch(() => (process.exitCode = 1)));
  if (args.includes('--init')) await close();
}
main().catch((error) => {
  console.error(redact((error as Error).message));
  process.exitCode = 1;
});
