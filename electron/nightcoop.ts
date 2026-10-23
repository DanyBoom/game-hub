import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { nightcoopInput, type ServerRecord, type NightcoopInfo } from '../shared/contracts';
import { download } from './downloads';
import { extractZip } from './archives';
import { inside, rejectLinks, atomicWrite, redact } from './security';
export const NIGHTCOOP_SOURCE = '6b694a6c86fd7c2b93743497ab3bd924553f25b8';
export const ENET_SOURCE = '5a9c537fd464b3c6d3c55e1d3bd47588faf71b42';
export function nightcoopPorts(
  s: Pick<ServerRecord, 'port' | 'nightcoop'>,
  cpuCount = os.cpus().length,
) {
  const count =
    s.nightcoop.shards === 'auto' ? Math.max(1, Math.min(64, cpuCount)) : s.nightcoop.shards;
  const ports = Array.from({ length: count }, (_, i) => (i === 0 ? s.port : s.port + 9 + i));
  if (ports.some((p) => p > 65535)) throw new Error('Диапазон портов NightCoop выходит за 65535');
  return ports;
}
export function nightcoopArgs(s: ServerRecord) {
  const n = nightcoopInput.parse(s.nightcoop);
  nightcoopPorts(s);
  const args = [
    String(s.port),
    '--shards',
    String(n.shards),
    '--max-clients',
    String(n.maxClients),
    '--sign-key',
    inside(s.root, 'hub-sign.key'),
  ];
  const numbers = {
    '--max-per-address': n.maxPerAddress,
    '--max-sessions': n.maxSessions,
    '--max-guests': n.maxGuests,
    '--max-packet-kb': n.maxPacketKB,
    '--idle-seconds': n.idleSeconds,
    '--guard-pool-mb': n.guardPoolMB,
    '--max-queue-kb': n.maxQueueKB,
    '--rcvbuf-kb': n.receiveBufferKB,
  };
  for (const [key, value] of Object.entries(numbers)) args.push(key, String(value));
  args.push(
    '--cookie',
    n.cookie,
    '--guard',
    n.guard ? 'on' : 'off',
    '--resume',
    n.resume ? 'on' : 'off',
  );
  if (n.cookieBusy) args.push('--cookie-busy', String(n.cookieBusy));
  // --stats also forces output while idle. Omit it to retain the vendor's quiet default.
  if (n.statsAlways || n.statsSeconds !== 300) args.push('--stats', String(n.statsSeconds));
  if (n.runSeconds) args.push('--seconds', String(n.runSeconds));
  if (n.bench) args.push('--bench');
  for (const name of n.hubNames) args.push('--hub-name', name);
  if (n.region) args.push('--region', n.region);
  if (n.logToFile) args.push('--log-dir', inside(s.root, 'logs'));
  if (n.useHubCert) args.push('--hub-cert', inside(s.root, 'hub.cert'));
  if (n.useHubList) args.push('--hub-list', inside(s.root, 'hub-list.bin'));
  if (n.useLocations) args.push('--locations', inside(s.root, 'locations.txt'));
  return args;
}
export async function configureNightcoop(s: ServerRecord) {
  nightcoopPorts(s);
  await atomicWrite(
    inside(s.root, 'nightcoop.json'),
    JSON.stringify({ port: s.port, ...s.nightcoop }, null, 2),
  );
}
async function execute(executable: string, args: string[], cwd: string, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    let out = '';
    const child = spawn(executable, args, {
      cwd,
      signal,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: cwd, LANG: 'C.UTF-8' },
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        out = (out + chunk.toString()).slice(-32000);
      });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error('NightCoop: команда завершилась с кодом ' + code + ': ' + redact(out))),
    );
  });
}
export async function installNightcoop(
  s: ServerRecord,
  signal: AbortSignal,
  progress: (phase: string) => void,
) {
  if (process.platform !== 'linux')
    throw new Error(
      'NightCoop Hub собирается и запускается в Linux-панели. Используйте Ubuntu 24.04+ или Debian 13+ на VPS.',
    );
  const version = await execute('/usr/bin/g++', ['-dumpversion'], s.root, signal).catch(() => {
    throw new Error(
      'Нужен g++ 13+ и gcc. Обновите серверный установщик GameHub или установите g++ в Linux.',
    );
  });
  if (parseInt(version) < 13)
    throw new Error('NightCoop требует g++ 13+: используйте Ubuntu 24.04+ / Debian 13+.');
  const stage = inside(s.root, '.nightcoop-build-' + crypto.randomUUID());
  await fs.mkdir(stage, { recursive: true });
  try {
    progress('Загрузка закреплённых исходников NightCoop и ENet');
    for (const [name, repo, ref] of [
      ['hub', 'Twenfys/nightcoop-hub', NIGHTCOOP_SOURCE],
      ['enet', 'lsalzman/enet', ENET_SOURCE],
    ]) {
      const archive = inside(stage, name + '.zip'),
        dest = inside(stage, name);
      await download(`https://github.com/${repo}/archive/${ref}.zip`, archive, {
        signal,
        limit: 32 * 1024 ** 2,
      });
      await extractZip(archive, dest);
    }
    const hub = inside(stage, 'hub/nightcoop-hub-' + NIGHTCOOP_SOURCE),
      enet = inside(stage, 'enet/enet-' + ENET_SOURCE),
      obj = inside(stage, 'obj');
    await fs.mkdir(obj);
    const objects: string[] = [],
      include = '-I' + inside(enet, 'include');
    const flags = [
      'HAS_FCNTL',
      'HAS_POLL',
      'HAS_SOCKLEN_T',
      'HAS_MSGHDR_FLAGS',
      'HAS_GETADDRINFO',
      'HAS_GETNAMEINFO',
      'HAS_INET_PTON',
      'HAS_INET_NTOP',
      'HAS_GETHOSTBYNAME_R',
      'HAS_GETHOSTBYADDR_R',
    ].map((n) => '-D' + n + '=1');
    for (const file of [
      'callbacks',
      'compress',
      'host',
      'list',
      'packet',
      'peer',
      'protocol',
      'unix',
    ]) {
      progress('Сборка ENet: ' + file);
      const output = inside(obj, 'enet_' + file + '.o');
      await execute(
        '/usr/bin/gcc',
        ['-c', '-O2', include, ...flags, inside(enet, file + '.c'), '-o', output],
        stage,
        signal,
      );
      objects.push(output);
    }
    const mono = inside(obj, 'monocypher.o');
    progress('Сборка Monocypher');
    await execute(
      '/usr/bin/gcc',
      ['-c', '-O2', inside(hub, 'vendor/monocypher/monocypher.c'), '-o', mono],
      stage,
      signal,
    );
    objects.push(mono);
    for (const file of [
      'src/Log.cpp',
      'src/NetCrypto.cpp',
      'src/HubServer.cpp',
      'tools/hub/main.cpp',
    ]) {
      progress('Сборка NightCoop: ' + path.basename(file));
      const output = inside(obj, path.basename(file, '.cpp') + '.o');
      await execute(
        '/usr/bin/g++',
        ['-c', '-std=c++20', '-O2', include, inside(hub, file), '-o', output],
        stage,
        signal,
      );
      objects.push(output);
    }
    const binary = inside(stage, 'nightcoop_hub');
    await execute(
      '/usr/bin/g++',
      ['-o', binary, ...objects, '-pthread', '-static-libstdc++', '-static-libgcc'],
      stage,
      signal,
    );
    const target = inside(s.root, 'nightcoop_hub');
    await rejectLinks(s.root, target);
    await fs.rename(binary, target);
    await fs.chmod(target, 0o700);
    const key = inside(s.root, 'hub-sign.key');
    await rejectLinks(s.root, key);
    if (
      !(await fs
        .access(key)
        .then(() => true)
        .catch(() => false))
    )
      await execute(target, ['--gen-sign-key', key], s.root, signal);
    await fs.chmod(key, 0o600);
    await atomicWrite(
      inside(s.root, 'nightcoop-build.json'),
      JSON.stringify({ source: NIGHTCOOP_SOURCE, enet: ENET_SOURCE }),
    );
    progress('NightCoop Hub собран; ключ создан и сохранён');
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}
export async function nightcoopInfo(s: ServerRecord): Promise<NightcoopInfo> {
  const result: NightcoopInfo = {
    ports: nightcoopPorts(s),
    source: NIGHTCOOP_SOURCE,
    installed: s.installed,
  };
  if (!s.installed) return result;
  const key = inside(s.root, 'hub-sign.key');
  await rejectLinks(s.root, key);
  const text = await execute(inside(s.root, 'nightcoop_hub'), ['--hub-public', key], s.root);
  const fingerprint = /^# fingerprint ([A-Z0-9-]+)$/m.exec(text)?.[1];
  if (!fingerprint) throw new Error('NightCoop не вернул отпечаток ключа');
  result.fingerprint = fingerprint;
  result.publicKeys = text;
  result.address =
    (s.nightcoop.address || 'YOUR-VPS-ADDRESS') +
    (s.port === 47800 ? '' : ':' + s.port) +
    '#' +
    fingerprint;
  return result;
}
export const nightcoopPublicFiles = ['hub.cert', 'hub-list.bin', 'locations.txt'] as const;
export async function saveNightcoopPublic(
  s: ServerRecord,
  name: (typeof nightcoopPublicFiles)[number],
  base64: string,
) {
  if (!nightcoopPublicFiles.includes(name))
    throw new Error('Недопустимый публичный файл NightCoop');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 1024 ** 2) throw new Error('Лимит публичного файла — 1 МБ');
  const tmp = inside(s.root, 'nightcoop-upload.tmp'),
    target = inside(s.root, name);
  await rejectLinks(s.root, target);
  await rejectLinks(s.root, tmp);
  try {
    await fs.writeFile(tmp, bytes, { mode: 0o600 });
    await execute(
      inside(s.root, 'nightcoop_hub'),
      [name === 'locations.txt' ? '--check-locations' : '--show', tmp],
      s.root,
    );
    await fs.rename(tmp, target);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
