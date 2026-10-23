import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import type { ServerRecord } from '../shared/contracts';
import { serverInput } from '../shared/contracts';
import { atomicWrite, inside, rejectLinks } from './security';
import { configureRacing, racingGames, parseIni, readJson } from './racing';
import { extraGames, extraBinary, configureExtra } from './extra-games';
export const binaryName = (s: ServerRecord) =>
  extraGames.has(s.game)
    ? extraBinary(s)
    : (
        {
          beammp: process.platform === 'win32' ? 'BeamMP-Server.exe' : 'BeamMP-Server',
          minecraft: 'server.jar',
          assetto: 'acServer.exe',
          acc: 'accServer.exe',
          evo: 'AssettoCorsaEVOServer.exe',
        } as Record<string, string>
      )[s.game];
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
    Debug: false,
    IP: '0.0.0.0',
    Description: s.beamDescription,
    Tags: s.beamTags,
    AllowGuests: s.beamGuests,
    LogChat: s.beamLogChat,
  };
  return TOML.stringify(parsed);
}
export async function configure(
  s: ServerRecord,
  secret: string,
  passwords: { password?: string; adminPassword?: string } = {},
) {
  const manifest = inside(s.root, 'gamehub-settings.json');
  await rejectLinks(s.root, manifest);
  await atomicWrite(
    manifest,
    JSON.stringify(
      Object.fromEntries(
        Object.keys(serverInput.shape)
          .filter((k) => !['authKey', 'password', 'adminPassword'].includes(k))
          .map((k) => [k, (s as any)[k]]),
      ),
      null,
      2,
    ),
  );
  if (racingGames.has(s.game)) {
    await configureRacing(s, passwords);
    return;
  }
  if (extraGames.has(s.game)) {
    await configureExtra(s, passwords.password);
    return;
  }
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
        'level-seed': s.seed.replace(
          /[^\x20-\x7e]/g,
          (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
        ),
        'level-type': s.levelType,
        'view-distance': String(s.viewDistance),
        'simulation-distance': String(s.simulationDistance),
        'spawn-protection': String(s.spawnProtection),
        pvp: String(s.pvp),
        hardcore: String(s.hardcore),
        'white-list': String(s.whitelist),
        'enforce-whitelist': String(s.whitelist),
        'generate-structures': String(s.generateStructures),
        'allow-flight': String(s.allowFlight),
        'enable-command-block': String(s.commandBlocks),
        'allow-nether': String(s.allowNether),
        'force-gamemode': String(s.forceGamemode),
      }),
    );
    const eula = inside(s.root, 'eula.txt');
    await rejectLinks(s.root, eula);
    await atomicWrite(eula, `# Accepted explicitly in GameHub\neula=${s.eula}\n`);
    for (const name of ['whitelist.json', 'ops.json', 'banned-players.json', 'banned-ips.json']) {
      const target = inside(s.root, name);
      await rejectLinks(s.root, target);
      if (
        !(await fs
          .access(target)
          .then(() => true)
          .catch(() => false))
      )
        await atomicWrite(target, '[]\n');
    }
  }
}
export async function readConfig(s: ServerRecord): Promise<Partial<ServerRecord>> {
  const manifest = await readJson(inside(s.root, 'gamehub-settings.json')).catch(() => ({}));
  const baseline = Object.fromEntries(
    Object.keys(serverInput.shape)
      .filter((k) => !['authKey', 'password', 'adminPassword'].includes(k) && k in manifest)
      .map((k) => [k, manifest[k]]),
  );
  if (extraGames.has(s.game)) return baseline;
  if (s.game === 'assetto') {
    const config = parseIni(await fs.readFile(inside(s.root, 'cfg/server_cfg.ini'), 'utf8'));
    const p = config.SERVER ?? {};
    return {
      ...baseline,
      name: p.NAME ?? s.name,
      port: Number(p.TCP_PORT ?? s.port),
      httpPort: Number(p.HTTP_PORT ?? s.httpPort),
      players: Number(p.MAX_CLIENTS ?? s.players),
      track: p.TRACK ?? s.track,
      trackLayout: p.CONFIG_TRACK ?? '',
      cars: (p.CARS ?? '').split(';').filter(Boolean),
    };
  }
  if (s.game === 'acc') {
    const p = await readJson(inside(s.root, 'cfg/settings.json')),
      event = await readJson(inside(s.root, 'cfg/event.json')),
      network = await readJson(inside(s.root, 'cfg/configuration.json'));
    return {
      ...baseline,
      name: p.serverName,
      port: network.tcpPort,
      players: p.maxCarSlots,
      track: event.track,
    };
  }
  if (s.game === 'evo') {
    const p = await readJson(inside(s.root, 'server_config.json')),
      season = await readJson(inside(s.root, 'season_config.json'));
    return {
      ...baseline,
      name: p.server_name,
      port: p.server_tcp_listener_port,
      httpPort: p.server_http_port,
      players: p.max_players,
      track: season.event?.track ?? s.track,
      trackLayout: season.event?.layout ?? '',
      cars: p.allowed_cars_list_full?.map((c: any) => c.car_name) ?? [],
    };
  }
  const file = inside(s.root, configName(s));
  await rejectLinks(s.root, file);
  const txt = await fs.readFile(file, 'utf8').catch(() => '');
  if (!txt) return {};
  if (s.game === 'beammp') {
    const g = TOML.parse(txt).General as Record<string, unknown>;
    if (!g) return {};
    return {
      ...baseline,
      name: String(g.Name ?? s.name),
      port: Number(g.Port ?? s.port),
      players: Number(g.MaxPlayers ?? s.players),
      map: String(g.Map ?? s.map),
      maxCars: Number(g.MaxCars ?? s.maxCars),
      public: g.Private === false,
      beamDescription: String(g.Description ?? s.beamDescription),
      beamTags: String(g.Tags ?? s.beamTags),
      beamGuests: g.AllowGuests === true,
      beamLogChat: g.LogChat === true,
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
    ...baseline,
    port: Number(p['server-port'] || s.port),
    players: Number(p['max-players'] || s.players),
    world: p['level-name'] || s.world,
    seed: p['level-seed'] ?? s.seed,
    levelType: (p['level-type'] ?? s.levelType) as ServerRecord['levelType'],
    difficulty: (p.difficulty ?? s.difficulty) as ServerRecord['difficulty'],
    gamemode: (p.gamemode ?? s.gamemode) as ServerRecord['gamemode'],
    viewDistance: Number(p['view-distance'] ?? s.viewDistance),
    simulationDistance: Number(p['simulation-distance'] ?? s.simulationDistance),
    spawnProtection: Number(p['spawn-protection'] ?? s.spawnProtection),
    pvp: p.pvp === undefined ? s.pvp : p.pvp === 'true',
    hardcore: p.hardcore === undefined ? s.hardcore : p.hardcore === 'true',
    whitelist: p['white-list'] === undefined ? s.whitelist : p['white-list'] === 'true',
  };
}
