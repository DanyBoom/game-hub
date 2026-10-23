import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as tar from 'tar';
import type { ServerRecord } from '../shared/contracts';
import { download, officialJson } from './downloads';
import { extractZip } from './archives';
import { inside, rejectLinks, atomicWrite, redact } from './security';

export const extraGames = new Set(['valheim', 'terraria', 'factorio']);
export async function extractTar(file: string, cwd: string) {
  await fs.mkdir(cwd, { recursive: true });
  let count = 0,
    bytes = 0;
  await tar.x({
    file,
    cwd,
    strict: true,
    preservePaths: false,
    filter(name, entry) {
      inside(cwd, name.replace(/\/$/, ''));
      if (++count > 100000 || (bytes += entry.size) > 8 * 1024 ** 3)
        throw new Error('Архив слишком велик');
      // Runtime distributions contain optional links. Never materialize links from archives.
      return ['File', 'Directory', 'OldFile', 'ContiguousFile'].includes(
        (entry as { type: string }).type,
      );
    },
  });
}
const envFor = (s: ServerRecord) => ({
  PATH: process.env.PATH,
  SYSTEMROOT: process.env.SYSTEMROOT,
  WINDIR: process.env.WINDIR,
  COMSPEC: process.env.COMSPEC,
  PATHEXT: process.env.PATHEXT,
  PROGRAMDATA: process.env.PROGRAMDATA,
  APPDATA: path.join(s.root, '.appdata'),
  LOCALAPPDATA: path.join(s.root, '.local'),
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  HOME: s.root,
  USERPROFILE: s.root,
});
export async function runTool(
  executable: string,
  args: string[],
  s: ServerRecord,
  signal: AbortSignal,
) {
  await new Promise<void>((resolve, reject) => {
    let tail = '';
    const child = spawn(executable, args, {
      cwd: s.root,
      env: envFor(s),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      signal,
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        tail = (tail + chunk.toString()).slice(-6000);
      });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error('Установщик завершился с кодом ' + code + ': ' + redact(tail))),
    );
  });
}
export function extraBinary(s: ServerRecord) {
  return s.game === 'terraria'
    ? process.platform === 'win32'
      ? 'TerrariaServer.exe'
      : 'TerrariaServer.bin.x86_64'
    : s.game === 'valheim'
      ? process.platform === 'win32'
        ? 'valheim_server.exe'
        : 'valheim_server.x86_64'
      : 'bin/x64/factorio';
}
export async function configureExtra(s: ServerRecord, password = '') {
  if (s.game === 'terraria') {
    await fs.mkdir(inside(s.root, 'worlds'), { recursive: true });
    await atomicWrite(
      inside(s.root, 'serverconfig.txt'),
      [
        `world=worlds/${s.world}.wld`,
        `autocreate=${s.worldSize}`,
        `worldname=${s.world}`,
        `difficulty=${s.worldMode}`,
        `seed=${s.seed}`,
        `maxplayers=${s.players}`,
        `port=${s.port}`,
        `password=${password}`,
        `motd=${s.name}`,
        'secure=1',
        'upnp=0',
        'language=en-US',
      ].join('\n'),
    );
  } else if (s.game === 'valheim') {
    await fs.mkdir(path.join(s.root, '.appdata'), { recursive: true });
    await fs.mkdir(path.join(s.root, '.local'), { recursive: true });
    await fs.mkdir(inside(s.root, 'worlds'), { recursive: true });
    // Password remains in the encrypted store and is read only while launching.
    await atomicWrite(
      inside(s.root, 'adminlist.txt'),
      await fs.readFile(inside(s.root, 'adminlist.txt'), 'utf8').catch(() => ''),
    );
  } else {
    const defaults = await fs
      .readFile(inside(s.root, 'data/server-settings.example.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => ({}));
    const settings = await fs
      .readFile(inside(s.root, 'server-settings.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => ({}));
    await atomicWrite(
      inside(s.root, 'server-settings.json'),
      JSON.stringify(
        {
          ...defaults,
          ...settings,
          name: s.name,
          max_players: s.players,
          game_password: password,
          visibility: { public: false, lan: true },
          require_user_verification: true,
          auto_pause: s.autoPause,
          autosave_interval: s.autosaveMinutes,
        },
        null,
        2,
      ),
    );
    if (s.seed && (!/^\d+$/.test(s.seed) || Number(s.seed) > 4294967295))
      throw new Error('Сид Factorio: целое число 0..4294967295');
    await atomicWrite(
      inside(s.root, 'map-gen-settings.json'),
      JSON.stringify({ seed: s.seed ? Number(s.seed) : 0 }),
    );
  }
}
export async function installExtra(
  s: ServerRecord,
  data: string,
  signal: AbortSignal,
  progress: (phase: string) => void,
) {
  progress('Загрузка официального сервера');
  if (s.game === 'terraria') {
    const names = await officialJson<string[]>(
      'https://terraria.org/api/get/dedicated-servers-names',
    );
    const name = names.find((n) => /^terraria-server-\d+\.zip$/.test(n));
    if (!name) throw new Error('Официальный каталог Terraria недоступен');
    const archive = inside(s.root, 'gamehub-download.zip'),
      stage = inside(s.root, '.install-terraria');
    await download('https://terraria.org/api/download/pc-dedicated-server/' + name, archive, {
      signal,
    });
    try {
      await extractZip(archive, stage);
      const version = (await fs.readdir(stage)).find((n) => /^\d+$/.test(n));
      if (!version) throw new Error('Неожиданная структура Terraria');
      const source = inside(
        stage,
        version + (process.platform === 'win32' ? '/Windows' : '/Linux'),
      );
      await fs.cp(source, s.root, {
        recursive: true,
        filter: async (file) => {
          await rejectLinks(stage, file);
          return true;
        },
      });
      s.version = version;
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
      await fs.rm(archive, { force: true });
    }
  } else if (s.game === 'valheim') {
    const steam = path.join(data, 'steamcmd');
    await fs.mkdir(steam, { recursive: true });
    const exe = path.join(
      steam,
      process.platform === 'win32' ? 'steamcmd.exe' : 'linux32/steamcmd',
    );
    if (
      !(await fs
        .access(exe)
        .then(() => true)
        .catch(() => false))
    ) {
      const archive = path.join(
        steam,
        process.platform === 'win32' ? 'steamcmd.zip' : 'steamcmd.tar.gz',
      );
      await download(
        'https://steamcdn-a.akamaihd.net/client/installer/' +
          path.basename(archive).replace('steamcmd.tar.gz', 'steamcmd_linux.tar.gz'),
        archive,
        { signal },
      );
      if (process.platform === 'win32') await extractZip(archive, steam);
      else await extractTar(archive, steam);
      await fs.rm(archive, { force: true });
    }
    progress('SteamCMD: установка Valheim, это может занять несколько минут');
    try {
      await runTool(exe, ['+quit'], s, signal);
    } catch (error) {
      if (signal.aborted || !/кодом 7:/.test((error as Error).message)) throw error;
      progress('SteamCMD обновился; проверка нового клиента');
      await runTool(exe, ['+quit'], s, signal);
    }
    await runTool(
      exe,
      [
        '+force_install_dir',
        s.root,
        '+login',
        'anonymous',
        '+app_info_update',
        '1',
        '+app_update',
        '896660',
        'validate',
        '+quit',
      ],
      s,
      signal,
    );
  } else {
    if (process.platform !== 'linux')
      throw new Error('Автоматическая headless-установка Factorio доступна в Linux-панели');
    const archive = inside(s.root, 'gamehub-download.tar.xz'),
      stage = inside(s.root, '.install-factorio');
    await download('https://factorio.com/get-download/stable/headless/linux64', archive, {
      signal,
    });
    // tar's JS implementation handles gzip, not xz. Extract a trusted vendor tar via fixed tar arguments.
    await fs.mkdir(stage, { recursive: true });
    await runTool(
      '/usr/bin/tar',
      ['-xJf', archive, '-C', stage, '--no-same-owner', '--no-same-permissions'],
      s,
      signal,
    );
    await rejectLinks(stage);
    await fs.cp(inside(stage, 'factorio'), s.root, {
      recursive: true,
      filter: async (file) => {
        await rejectLinks(stage, file);
        return true;
      },
    });
    await fs.rm(stage, { recursive: true, force: true });
    await fs.rm(archive, { force: true });
  }
  if (process.platform !== 'win32') await fs.chmod(inside(s.root, extraBinary(s)), 0o700);
  progress('Установка завершена');
}
export function extraLaunch(s: ServerRecord, password: string) {
  if (s.game === 'terraria') return ['-config', 'serverconfig.txt'];
  if (s.game === 'factorio')
    return [
      '--start-server',
      `worlds/${s.world}.zip`,
      '--server-settings',
      'server-settings.json',
      '--port',
      String(s.port),
      '--mod-directory',
      'mods',
    ];
  return [
    '-nographics',
    '-batchmode',
    '-name',
    s.name,
    '-port',
    String(s.port),
    '-world',
    s.world,
    '-password',
    password,
    '-public',
    s.public ? '1' : '0',
    '-savedir',
    path.join(s.root, 'worlds'),
    ...(s.crossplay ? ['-crossplay'] : []),
  ];
}
