import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shell } from 'electron';
import type { GameId } from '../shared/contracts';
import { rejectLinks } from './security';
const execute = promisify(execFile);
export const steamTools = {
  assetto: {
    id: 302550,
    folders: ['Assetto Corsa Dedicated Server', 'assettocorsa/server'],
    exe: 'acServer.exe',
  },
  acc: {
    id: 1430110,
    folders: [
      'Assetto Corsa Competizione Dedicated Server/server',
      'Assetto Corsa Competizione Dedicated Server',
      'Assetto Corsa Competizione/server',
    ],
    exe: 'accServer.exe',
  },
  evo: {
    id: 4564210,
    folders: ['Assetto Corsa EVO Dedicated Server'],
    exe: 'AssettoCorsaEVOServer.exe',
  },
} as const;
export async function steamLibraries(): Promise<string[]> {
  let base = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam');
  try {
    const { stdout } = await execute(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { windowsHide: true },
    );
    const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout);
    if (m) base = m[1].trim();
  } catch {}
  const libraries = new Set([base]);
  const vdf = await fs
    .readFile(path.join(base, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    .catch(() => '');
  for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(m[1].replace(/\\\\/g, '\\'));
  return [...libraries].map((l) => path.join(l, 'steamapps', 'common'));
}
export async function detectTool(game: GameId): Promise<string | undefined> {
  if (!(game in steamTools)) return;
  const tool = steamTools[game as keyof typeof steamTools];
  for (const common of await steamLibraries())
    for (const folder of tool.folders) {
      const dir = path.join(common, folder);
      if (
        await fs
          .access(path.join(dir, tool.exe))
          .then(() => true)
          .catch(() => false)
      )
        return dir;
    }
}
export async function detectGame(game: GameId) {
  const names: Partial<Record<GameId, string>> = {
    assetto: 'assettocorsa',
    acc: 'Assetto Corsa Competizione',
    evo: 'Assetto Corsa EVO',
    beammp: 'BeamNG.drive',
  };
  if (!names[game]) return;
  for (const common of await steamLibraries()) {
    const dir = path.join(common, names[game]!);
    if (
      await fs
        .access(dir)
        .then(() => true)
        .catch(() => false)
    )
      return dir;
  }
}
export async function requestSteamInstall(game: GameId) {
  if (!(game in steamTools)) throw new Error('Нет Steam-инструмента');
  await shell.openExternal(`steam://install/${steamTools[game as keyof typeof steamTools].id}`);
}
export async function copyTool(source: string, target: string, onFile?: (name: string) => void) {
  await rejectLinks(source);
  await fs.mkdir(target, { recursive: true });
  await rejectLinks(target);
  const walk = async (dir: string) => {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (['cfg', 'logs', 'log', 'results', 'presets', 'manager'].includes(item.name.toLowerCase()))
        continue;
      const from = path.join(dir, item.name);
      await rejectLinks(source, from);
      const dest = path.join(target, path.relative(source, from));
      await rejectLinks(target, dest);
      if (item.isDirectory()) {
        await fs.mkdir(dest, { recursive: true });
        await walk(from);
      } else if (item.isFile()) {
        await fs.copyFile(from, dest);
        onFile?.(item.name);
      }
    }
  };
  await walk(source);
}
