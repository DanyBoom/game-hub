import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import type { ServerRecord } from '../shared/contracts';
import { atomicWrite, inside, rejectLinks } from './security';
export const binaryName = (s: ServerRecord) =>
  s.game === 'beammp' ? 'BeamMP-Server.exe' : 'server.jar';
export const configName = (s: ServerRecord) =>
  s.game === 'beammp' ? 'ServerConfig.toml' : 'server.properties';
export function propertiesPatch(text: string, updates: Record<string, string>) {
  const pending = new Map(Object.entries(updates));
  const lines = text.split(/\r?\n/).map((line) => {
    const match = /^([^#!\s][^=:\s]*)\s*[=:]\s*(.*)$/.exec(line);
    if (!match || !(match[1] in updates)) return line;
    pending.delete(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  return [...lines, ...[...pending].map(([k, v]) => `${k}=${v}`)].join('\n');
}
export function beamConfig(text: string, s: ServerRecord, secret: string) {
  const parsed = text.trim() ? TOML.parse(text) : {};
  const old = parsed.General;
  parsed.General = {
    ...(typeof old === 'object' && old !== null ? old : {}),
    Port: s.port,
    AuthKey: secret,
    Name: s.name,
    MaxPlayers: s.players,
    MaxCars: s.maxCars,
    Map: s.map,
    Private: !s.public,
    ResourceFolder: 'Resources',
    LogChat: false,
    Debug: false,
    IP: '0.0.0.0',
  };
  return TOML.stringify(parsed);
}
export async function configure(s: ServerRecord, secret: string) {
  const file = inside(s.root, configName(s));
  await rejectLinks(s.root, file);
  const previous = await fs.readFile(file, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return '';
    throw e;
  });
  if (s.game === 'beammp') {
    await fs.mkdir(inside(s.root, 'Resources/Client'), { recursive: true });
    await atomicWrite(file, beamConfig(previous, s, secret));
  } else {
    await atomicWrite(
      file,
      propertiesPatch(previous, {
        'server-port': String(s.port),
        'max-players': String(s.players),
        motd: s.name.replace(
          /[^\x20-\x7e]/g,
          (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
        ),
        'level-name': s.world,
        difficulty: s.difficulty,
        gamemode: s.gamemode,
        'online-mode': 'true',
        'enable-rcon': 'false',
        'enable-query': 'false',
        'server-ip': '',
      }),
    );
    const eula = inside(s.root, 'eula.txt');
    await rejectLinks(s.root, eula);
    await atomicWrite(eula, `# Accepted explicitly in GameHub\neula=${s.eula}\n`);
  }
}
export async function readConfig(s: ServerRecord): Promise<Partial<ServerRecord>> {
  const file = inside(s.root, configName(s));
  await rejectLinks(s.root, file);
  const txt = await fs.readFile(file, 'utf8').catch(() => '');
  if (!txt) return {};
  if (s.game === 'beammp') {
    const g = TOML.parse(txt).General as Record<string, unknown>;
    if (!g) return {};
    return {
      name: String(g.Name ?? s.name),
      port: Number(g.Port ?? s.port),
      players: Number(g.MaxPlayers ?? s.players),
      map: String(g.Map ?? s.map),
      maxCars: Number(g.MaxCars ?? s.maxCars),
      public: g.Private === false,
    };
  }
  const p = Object.fromEntries(
    txt
      .split(/\r?\n/)
      .filter((l) => !/^\s*[#!]/.test(l))
      .map((l) => {
        const n = l.indexOf('=');
        return n < 0 ? ['', ''] : [l.slice(0, n).trim(), l.slice(n + 1).trim()];
      }),
  );
  return {
    port: Number(p['server-port'] || s.port),
    players: Number(p['max-players'] || s.players),
    world: p['level-name'] || s.world,
  };
}
