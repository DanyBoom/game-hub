import fs from 'node:fs/promises';
import { nightcoopInput } from '../shared/contracts';
import { nightcoopPorts } from './nightcoop';
import path from 'node:path';
import type { ServerRecord, ConfigDocument, GameOptions } from '../shared/contracts';
import { atomicWrite, inside, rejectLinks } from './security';
import { detectGame, detectTool } from './steam';
import { accTracks, beamMaps } from '../shared/options';
import { deflateSync } from 'node:zlib';
import TOML from '@iarna/toml';
export const racingGames = new Set(['assetto', 'acc', 'evo']);
export function parseIni(text: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = Object.create(null);
  let section = '';
  result[section] = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      section = header[1];
      result[section] ??= Object.create(null);
      continue;
    }
    const m = /^\s*([^;#=][^=]*?)\s*=(.*)$/.exec(line);
    if (m) result[section][m[1].trim()] = m[2].trim();
  }
  return result;
}
export function patchIni(text: string, sections: Record<string, Record<string, unknown>>) {
  const pending = new Map(
    Object.entries(sections).map(([s, v]) => [s, new Map(Object.entries(v))]),
  );
  let section = '';
  const output: string[] = [];
  const flush = () => {
    for (const [key, value] of pending.get(section) ?? []) output.push(`${key}=${value}`);
    pending.delete(section);
  };
  for (const line of text.split(/\r?\n/)) {
    const h = /^\s*\[([^\]]+)\]/.exec(line);
    if (h) {
      flush();
      section = h[1];
      output.push(line);
      continue;
    }
    const m = /^\s*([^;#=][^=]*?)\s*=/.exec(line);
    const key = m?.[1].trim();
    if (key && sections[section] && key in sections[section]) {
      output.push(`${key}=${sections[section][key]}`);
      pending.get(section)?.delete(key);
    } else output.push(line);
  }
  flush();
  for (const [name, values] of pending) {
    output.push('', `[${name}]`);
    for (const [key, value] of values) output.push(`${key}=${value}`);
  }
  return output.join('\n');
}
export function decodeJson(bytes: Buffer) {
  let text: string;
  if (bytes[0] === 255 && bytes[1] === 254) text = bytes.subarray(2).toString('utf16le');
  else if (bytes[1] === 0) text = bytes.toString('utf16le');
  else text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}
export async function readJson(file: string) {
  return decodeJson(await fs.readFile(file));
}
export async function writeJson(file: string, value: unknown, utf16 = false) {
  const json = JSON.stringify(value, null, 2);
  await atomicWrite(
    file,
    utf16 ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(json, 'utf16le')]) : json,
  );
}
const acFiles = ['cfg/server_cfg.ini', 'cfg/entry_list.ini'];
const accFiles = [
  'cfg/configuration.json',
  'cfg/settings.json',
  'cfg/event.json',
  'cfg/eventRules.json',
  'cfg/assistRules.json',
  'cfg/entrylist.json',
  'cfg/bop.json',
];
export async function configureRacing(
  s: ServerRecord,
  secrets: { password?: string; adminPassword?: string },
) {
  await fs.mkdir(inside(s.root, 'cfg'), { recursive: true });
  if (s.game === 'assetto') {
    const file = inside(s.root, acFiles[0]);
    await rejectLinks(s.root, file);
    const previous = await fs.readFile(file, 'utf8').catch(() => '');
    await atomicWrite(
      file,
      patchIni(previous, {
        SERVER: {
          NAME: s.name,
          CARS: s.cars.join(';'),
          TRACK: s.track,
          CONFIG_TRACK: s.trackLayout,
          MAX_CLIENTS: s.players,
          TCP_PORT: s.port,
          UDP_PORT: s.port,
          HTTP_PORT: s.httpPort,
          PASSWORD: secrets.password ?? '',
          ADMIN_PASSWORD: secrets.adminPassword ?? '',
          REGISTER_TO_LOBBY: s.public ? 1 : 0,
          PICKUP_MODE_ENABLED: 1,
          LOOP_MODE: 1,
          SLEEP_TIME: 1,
          CLIENT_SEND_INTERVAL_HZ: 18,
          RACE_OVER_TIME: 180,
          FUEL_RATE: s.fuelRate,
          TYRE_WEAR_RATE: s.tyreWear,
          DAMAGE_MULTIPLIER: s.damage,
          ABS_ALLOWED: s.abs,
          TC_ALLOWED: s.tc,
          STABILITY_ALLOWED: 0,
          AUTOCLUTCH_ALLOWED: 1,
          ALLOWED_TYRES_OUT: 2,
          SUN_ANGLE: Math.round((s.timeOfDay - 12) * 16),
        },
        PRACTICE: { NAME: 'Practice', TIME: s.practiceMinutes, IS_OPEN: 1 },
        QUALIFY: { NAME: 'Qualifying', TIME: s.qualifyMinutes, IS_OPEN: 1 },
        RACE: { NAME: 'Race', LAPS: s.raceLaps, TIME: s.raceMinutes, WAIT_TIME: 60, IS_OPEN: 1 },
        DYNAMIC_TRACK: {
          SESSION_START: s.grip,
          RANDOMNESS: 0,
          SESSION_TRANSFER: 100,
          LAP_GAIN: 50,
        },
        WEATHER_0: {
          GRAPHICS: s.weather,
          BASE_TEMPERATURE_AMBIENT: s.ambientTemp,
          BASE_TEMPERATURE_ROAD: s.roadTemp - s.ambientTemp,
          VARIATION_AMBIENT: 0,
          VARIATION_ROAD: 0,
        },
      }),
    );
    const entryFile = inside(s.root, acFiles[1]);
    await rejectLinks(s.root, entryFile);
    const old = parseIni(await fs.readFile(entryFile, 'utf8').catch(() => ''));
    const entries: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < s.players; i++) {
      const car = s.cars[i % Math.max(1, s.cars.length)] ?? '';
      const existing = old['CAR_' + i] ?? {};
      entries['CAR_' + i] = {
        ...existing,
        MODEL: car,
        SKIN: existing.MODEL === car ? (existing.SKIN ?? '') : '',
        SPECTATOR_MODE: 0,
        DRIVERNAME: existing.DRIVERNAME ?? '',
        TEAM: existing.TEAM ?? '',
        GUID: existing.GUID ?? '',
        BALLAST: existing.BALLAST ?? 0,
        RESTRICTOR: existing.RESTRICTOR ?? 0,
      };
    }
    await atomicWrite(
      entryFile,
      Object.entries(entries)
        .map(
          ([name, keys]) =>
            `[${name}]\n` +
            Object.entries(keys)
              .map(([k, v]) => k + '=' + v)
              .join('\n'),
        )
        .join('\n\n'),
    );
  } else if (s.game === 'acc') {
    const updates: Record<string, unknown> = {
      'configuration.json': {
        tcpPort: s.port,
        udpPort: s.port,
        registerToLobby: s.public ? 1 : 0,
        lanDiscovery: 1,
        maxConnections: s.players + 5,
        configVersion: 1,
      },
      'settings.json': {
        serverName: s.name,
        password: secrets.password ?? '',
        adminPassword: secrets.adminPassword ?? '',
        spectatorPassword: '',
        maxCarSlots: s.players,
        carGroup: s.carGroup,
        trackMedalsRequirement: s.trackMedals,
        safetyRatingRequirement: s.safetyRating,
        racecraftRatingRequirement: -1,
        isRaceLocked: 0,
        shortFormationLap: 0,
        formationLapType: s.formationLap,
        dumpLeaderboards: 1,
        configVersion: 1,
      },
      'event.json': {
        track: s.track,
        ambientTemp: s.ambientTemp,
        cloudLevel: s.cloud,
        rain: s.rain,
        weatherRandomness: 0,
        postQualySeconds: 10,
        postRaceSeconds: 30,
        preRaceWaitingTimeSeconds: 60,
        sessionOverTimeSeconds: 120,
        sessions: [
          ...(s.practiceMinutes
            ? [
                {
                  hourOfDay: s.timeOfDay,
                  dayOfWeekend: 1,
                  timeMultiplier: s.timeMultiplier,
                  sessionType: 'P',
                  sessionDurationMinutes: s.practiceMinutes,
                },
              ]
            : []),
          ...(s.qualifyMinutes
            ? [
                {
                  hourOfDay: s.timeOfDay,
                  dayOfWeekend: 2,
                  timeMultiplier: s.timeMultiplier,
                  sessionType: 'Q',
                  sessionDurationMinutes: s.qualifyMinutes,
                },
              ]
            : []),
          {
            hourOfDay: s.timeOfDay,
            dayOfWeekend: 3,
            timeMultiplier: s.timeMultiplier,
            sessionType: 'R',
            sessionDurationMinutes: s.raceMinutes,
          },
        ],
      },
      'eventRules.json': {
        qualifyStandingType: 1,
        pitWindowLengthSec: s.pitWindowLength < 0 ? -1 : s.pitWindowLength * 60,
        mandatoryPitstopCount: s.mandatoryPits,
        maxDriversCount: 1,
        isRefuellingAllowedInRace: s.refuellingAllowed,
        isRefuellingTimeFixed: false,
        isMandatoryPitstopRefuellingRequired: false,
        isMandatoryPitstopSwapDriverRequired: false,
        tyreSetCount: 50,
        isMandatoryPitstopTyreChangeRequired: s.tyreChangeRequired,
        driverStintTimeSec: s.driverStint < 0 ? -1 : s.driverStint * 60,
        maxTotalDrivingTime: s.maxTotalDriving < 0 ? -1 : s.maxTotalDriving * 60,
      },
      'assistRules.json': {
        stabilityControlLevelMax: 0,
        disableAutosteer: 1,
        disableAutoLights: 0,
        disableAutoWiper: 0,
        disableAutoEngineStart: 0,
        disableAutoPitLimiter: 0,
        disableAutoGear: 0,
        disableAutoClutch: 0,
        disableIdealLine: 0,
      },
    };
    for (const [name, values] of Object.entries(updates)) {
      const file = inside(s.root, 'cfg/' + name);
      await rejectLinks(s.root, file);
      const old = await readJson(file).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return {};
        throw e;
      });
      await writeJson(file, { ...old, ...(values as object) }, true);
    }
    for (const [name, initial] of Object.entries({
      'entrylist.json': { entries: [], forceEntryList: 0 },
      'bop.json': { entries: [] },
    })) {
      const file = inside(s.root, 'cfg/' + name);
      await rejectLinks(s.root, file);
      if (
        !(await fs
          .access(file)
          .then(() => true)
          .catch(() => false))
      )
        await writeJson(file, initial, true);
    }
  } else if (s.game === 'evo') {
    const eventsFile =
      s.evoMode === 'GameModeType_PRACTICE' ? 'events_practice.json' : 'events_race_weekend.json';
    const events = (await readJson(inside(s.root, eventsFile)).catch(() => ({ events: [] })))
      .events;
    const event = events.find(
      (e: any) => e.track === s.track && (!s.trackLayout || e.layout === s.trackLayout),
    );
    const configFile = inside(s.root, 'server_config.json'),
      seasonFile = inside(s.root, 'season_config.json');
    await rejectLinks(s.root, configFile);
    await rejectLinks(s.root, seasonFile);
    const config = await readJson(configFile).catch(() => ({})),
      season = await readJson(seasonFile).catch(() => ({}));
    const time = {
      year: 2026,
      month: 6,
      day: 15,
      hour: s.timeOfDay,
      minute: 0,
      second: 0,
      time_multiplier: s.timeMultiplier,
    };
    const session: Record<string, unknown> = {};
    for (const [key, minutes] of [
      ['practice', s.practiceMinutes],
      ['qualify', s.qualifyMinutes],
      ['warmup', s.evoWarmup],
      ['race', s.raceMinutes],
    ] as const) {
      session[key + '_duration'] = minutes * 60;
      session[key + '_time_of_day'] = { ...time };
      session[key + '_overtime_waiting_next_session'] = 60;
      session[key + '_max_wait_to_box'] = 120;
    }
    session.race_duration_type = 'GameModeSelectionDuration_TIME';
    session.min_waiting_for_players = 10;
    session.max_waiting_for_players = 60;
    session.mandatory_pit_stop = s.mandatoryPits > 0;
    session.requires_tyre_change = s.tyreChangeRequired;
    session.requires_refuelling = false;
    session.pit_window = s.pitWindowLength < 0 ? 0 : s.pitWindowLength * 60;
    await writeJson(configFile, {
      ...config,
      server_tcp_listener_port: s.port,
      server_udp_listener_port: s.port,
      server_tcp_internal_port: s.port,
      server_udp_internal_port: s.port,
      server_http_port: s.httpPort,
      server_name: s.name,
      max_players: s.players,
      cycle: s.evoCycle,
      allowed_cars_list_full: s.cars.map((car_name) => ({ car_name, ballast: 0, restrictor: 0 })),
      driver_password: secrets.password ?? '',
      spectator_password: '',
      admin_password: secrets.adminPassword ?? '',
      type: s.evoRanked
        ? 'MultiplayerServerListSessionType_RANKED'
        : 'MultiplayerServerListSessionType_UNRANKED',
      entry_list_path: '',
      results_path: 'results',
    });
    await writeJson(seasonFile, {
      ...season,
      game_type: s.evoMode,
      event: event ?? { track: s.track, layout: s.trackLayout, event_name: '', track_length: 0 },
      export_json: false,
      game_config: { ...(season.game_config ?? {}), ...session },
      weather_type: s.evoWeather,
      weather_behaviour: s.evoWeatherDynamic
        ? 'GameModeSelectionWeatherBehaviour_DYNAMIC'
        : 'GameModeSelectionWeatherBehaviour_STATIC',
      initial_grip:
        s.grip >= 99
          ? 'InitialGrip_OPTIMUM'
          : s.grip >= 95
            ? 'InitialGrip_FAST'
            : 'InitialGrip_GREEN',
    });
  }
}
const secretKey = (key: string) => /password|authkey|token|secret/i.test(key);
export function maskConfig(value: any): any {
  if (Array.isArray(value)) return value.map(maskConfig);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        secretKey(k) && v ? '__GAMEHUB_KEEP_SECRET__' : maskConfig(v),
      ]),
    );
  return value;
}
export function restoreMasked(value: any, old: any): any {
  if (Array.isArray(value)) return value.map((v, i) => restoreMasked(v, old?.[i]));
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k))
        throw new Error('Недопустимое поле');
      result[k] = v === '__GAMEHUB_KEEP_SECRET__' ? (old?.[k] ?? '') : restoreMasked(v, old?.[k]);
    }
    return result;
  }
  return value;
}
export async function configurationFiles(s: ServerRecord) {
  if (s.game === 'nightcoop') return ['nightcoop.json'];
  if (s.game === 'beammp') return ['ServerConfig.toml'];
  if (s.game === 'minecraft')
    return [
      'server.properties',
      'whitelist.json',
      'ops.json',
      'banned-players.json',
      'banned-ips.json',
    ];
  if (s.game === 'assetto') return acFiles;
  if (s.game === 'acc') return accFiles;
  if (s.game === 'evo') return ['server_config.json', 'season_config.json'];
  if (s.game === 'terraria') return ['serverconfig.txt'];
  if (s.game === 'valheim') return ['adminlist.txt', 'bannedlist.txt', 'permittedlist.txt'];
  if (s.game === 'factorio')
    return ['server-settings.json', 'map-gen-settings.json', 'mods/mod-list.json'];
  return [];
}
export async function configDocuments(s: ServerRecord): Promise<ConfigDocument[]> {
  const docs: ConfigDocument[] = [];
  for (const name of await configurationFiles(s)) {
    const file = inside(s.root, name);
    await rejectLinks(s.root, file);
    try {
      let format: ConfigDocument['format'] = 'json',
        data: any;
      if (name.endsWith('.ini')) {
        format = 'ini';
        data = parseIni(await fs.readFile(file, 'utf8'));
      } else if (name.endsWith('.toml')) {
        format = 'json';
        data = TOML.parse(await fs.readFile(file, 'utf8'));
      } else if (s.game === 'valheim' && name.endsWith('.txt')) {
        data = {
          entries: (await fs.readFile(file, 'utf8'))
            .split(/\r?\n/)
            .filter((l) => l.trim() && !l.startsWith('//')),
        };
      } else if (name === 'server.properties' || name === 'serverconfig.txt') {
        format = 'properties';
        data = Object.fromEntries(
          (await fs.readFile(file, 'utf8'))
            .split(/\r?\n/)
            .map((l) => /^\s*([^#!\s][^=]*?)\s*=(.*)$/.exec(l))
            .filter(Boolean)
            .map((m) => [m![1], m![2]]),
        );
      } else {
        data = await readJson(file);
        if (s.game === 'acc') {
          const effective = await readJson(
            inside(s.root, 'cfg/current/' + path.basename(name, '.json') + '.txt'),
          ).catch(() => ({}));
          data = { ...effective, ...data };
        }
        if (Array.isArray(data)) data = { entries: data };
      }
      docs.push({ name, format, data: maskConfig(data) });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return docs;
}
export async function saveConfigDocument(
  s: ServerRecord,
  name: string,
  value: Record<string, unknown>,
) {
  if (s.game === 'nightcoop') {
    if (name !== 'nightcoop.json') throw new Error('Недопустимый файл NightCoop');
    const { port, ...settings } = value;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Недопустимый UDP-порт');
    const parsed = nightcoopInput.parse(settings);
    nightcoopPorts({ port, nightcoop: parsed });
    await atomicWrite(inside(s.root, name), JSON.stringify({ port, ...parsed }, null, 2));
    return;
  }
  if (!(await configurationFiles(s)).includes(name))
    throw new Error('Недопустимый конфигурационный файл');
  const file = inside(s.root, name);
  await rejectLinks(s.root, file);
  if (s.game === 'valheim' && name.endsWith('.txt')) {
    const entries = value.entries;
    if (
      !Array.isArray(entries) ||
      entries.length > 1000 ||
      entries.some((v) => typeof v !== 'string' || /[\r\n\0]/.test(v) || v.length > 100)
    )
      throw new Error('Ожидается список Platform User ID');
    await atomicWrite(file, entries.join('\n') + '\n');
    return;
  }
  const old = name.endsWith('.ini')
    ? parseIni(await fs.readFile(file, 'utf8'))
    : name.endsWith('.toml')
      ? TOML.parse(await fs.readFile(file, 'utf8'))
      : name === 'server.properties' || name === 'serverconfig.txt'
        ? Object.fromEntries(
            (await fs.readFile(file, 'utf8'))
              .split(/\r?\n/)
              .map((l) => /^([^#!\s][^=]*)=(.*)$/.exec(l))
              .filter(Boolean)
              .map((m) => [m![1], m![2]]),
          )
        : await readJson(file);
  const data = restoreMasked(value, Array.isArray(old) ? { entries: old } : old);
  if (name.endsWith('.ini')) {
    for (const [section, values] of Object.entries(data)) {
      if (/[\r\n\[\]]/.test(section) || typeof values !== 'object' || !values)
        throw new Error('Недопустимая INI секция');
      for (const [k, v] of Object.entries(values)) {
        if (/[\r\n=]/.test(k) || /[\r\n]/.test(String(v)))
          throw new Error('Недопустимое INI значение');
      }
    }
    await atomicWrite(file, patchIni(await fs.readFile(file, 'utf8'), data));
  } else if (name.endsWith('.toml')) await atomicWrite(file, TOML.stringify(data));
  else if (name === 'server.properties' || name === 'serverconfig.txt') {
    const pending = new Map(Object.entries(data));
    for (const [k, v] of pending)
      if (/[\r\n=:]/.test(k) || /[\r\n]/.test(String(v)))
        throw new Error('Недопустимое значение properties');
    const text = (await fs.readFile(file, 'utf8')).split(/\r?\n/).map((line) => {
      const m = /^\s*([^#!\s][^=]*?)\s*=/.exec(line);
      if (!m || !Object.prototype.hasOwnProperty.call(data, m[1])) return line;
      const value = data[m[1]];
      pending.delete(m[1]);
      return m[1] + '=' + value;
    });
    for (const [k, v] of pending) text.push(k + '=' + v);
    await atomicWrite(file, text.join('\n'));
  } else await writeJson(file, Array.isArray(old) ? data.entries : data, s.game === 'acc');
}
export async function gameOptions(s: ServerRecord): Promise<GameOptions> {
  const result: GameOptions = {
    maps: [...beamMaps],
    tracks: [],
    cars: [],
    layouts: {},
    weather: [],
    steamInstalled: !!(await detectTool(s.game)),
  };
  if (s.game === 'acc') {
    result.tracks = [...accTracks];
    return result;
  }
  if (s.game === 'assetto') {
    const game = await detectGame('assetto');
    const roots = [s.root, ...(game ? [game] : [])];
    const cars = new Map<string, string>(),
      tracks = new Map<string, string>();
    for (const root of roots) {
      for (const item of await fs
        .readdir(path.join(root, 'content', 'cars'), { withFileTypes: true })
        .catch(() => []))
        if (item.isDirectory()) {
          const ui = await readJson(
            path.join(root, 'content', 'cars', item.name, 'ui', 'ui_car.json'),
          ).catch(() => ({}));
          cars.set(item.name, ui.name ?? item.name);
        }
      for (const item of await fs
        .readdir(path.join(root, 'content', 'tracks'), { withFileTypes: true })
        .catch(() => []))
        if (item.isDirectory()) {
          const ui = await readJson(
            path.join(root, 'content', 'tracks', item.name, 'ui', 'ui_track.json'),
          ).catch(() => ({}));
          tracks.set(item.name, ui.name ?? item.name);
          const layouts = await fs
            .readdir(path.join(root, 'content', 'tracks', item.name))
            .catch(() => []);
          result.layouts[item.name] = layouts
            .filter((l) => /^models_.+\.ini$/.test(l))
            .map((l) => ({ value: l.slice(7, -4), label: l.slice(7, -4) }));
        }
      for (const name of await fs.readdir(path.join(root, 'content', 'weather')).catch(() => []))
        if (!result.weather.some((w) => w.value === name))
          result.weather.push({ value: name, label: name });
    }
    result.cars = [...cars]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
    result.tracks = [...tracks]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } else if (s.game === 'evo') {
    // Preserve official metadata; schemas can change during early access.
    for (const name of ['cars.json', 'events_practice.json', 'events_race_weekend.json']) {
      const file = path.join(s.root, name);
      const data = await readJson(file).catch(() => null);
      if (!data) continue;
      const values = data.cars ?? data.events ?? [];
      for (const value of values as any[]) {
        if (typeof value === 'object' && value) {
          const id = value.track ?? value.name;
          const label = value.display_name ?? value.track ?? value.name;
          if (id !== undefined) {
            const target = name === 'cars.json' ? result.cars : result.tracks;
            if (!target.some((c) => c.value === String(id)))
              target.push({ value: String(id), label: String(label) });
            if (value.track && value.layout) {
              result.layouts[value.track] ??= [];
              if (!result.layouts[value.track].some((l) => l.value === value.layout))
                result.layouts[value.track].push({ value: value.layout, label: value.layout });
            }
          }
        }
      }
    }
  }
  return result;
}
export function encodeEvoDocument(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, deflateSync(bytes)]).toString('base64');
}
export async function evoArguments(s: ServerRecord) {
  const files = ['server_config.json', 'season_config.json'];
  const values = [];
  for (const name of files) {
    const file = inside(s.root, name);
    await rejectLinks(s.root, file);
    values.push(encodeEvoDocument(await readJson(file)));
  }
  return [
    '-serverconfig',
    values[0],
    '-seasondefinition',
    values[1],
    ...(!s.public ? ['-no_lobby=true'] : []),
  ];
}
