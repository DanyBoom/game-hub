import fs from 'node:fs/promises';
import path from 'node:path';
import TOML from '@iarna/toml';
import type { ServerRecord, ContentDetails } from '../shared/contracts';
import { inside, rejectLinks, atomicWrite } from './security';
import { hashFile } from './archives';

export function contentPath(s: ServerRecord, name: string) {
  if (s.game === 'assetto') return inside(s.root, 'content/' + name);
  if (s.game === 'beammp')
    return inside(
      s.root,
      name.startsWith('server/') ? 'Resources/Server/' + name.slice(7) : 'Resources/Client/' + name,
    );
  if (s.game === 'factorio') return inside(s.root, 'mods/' + name);
  if (s.game !== 'minecraft') throw new Error('Эта игра не поддерживает такой контент');
  if (name.startsWith('datapacks/'))
    return inside(s.root, s.world + '/datapacks/' + name.slice(10));
  return inside(s.root, (s.core === 'paper' ? 'plugins/' : 'mods/') + name);
}
export async function actualContentPath(s: ServerRecord, name: string, enabled: boolean) {
  if (s.game === 'assetto' && !enabled) return inside(s.root, 'disabled/content/' + name);
  if (s.game === 'beammp' && name.startsWith('server/') && !enabled)
    return inside(s.root, 'disabled/Resources/Server/' + name.slice(7));
  return contentPath(s, name);
}
// Only discovered text settings are editable; executable scripts and arbitrary server paths are excluded.
async function configPaths(s: ServerRecord, name: string, source: string) {
  const roots: string[] = [];
  if (s.game === 'beammp' && name.startsWith('server/')) roots.push(source);
  if (s.game === 'minecraft') {
    const stem = path
      .basename(name)
      .replace(/\.disabled$/, '')
      .replace(/\.jar$/i, '')
      .replace(/[-_]?\d.*$/, '')
      .toLowerCase();
    if (stem.length < 2) return [];
    for (const parent of ['config', 'plugins']) {
      const dir = inside(s.root, parent);
      await rejectLinks(s.root, dir);
      for (const entry of await fs.readdir(dir).catch(() => []))
        if (entry.toLowerCase().startsWith(stem)) roots.push(inside(dir, entry));
    }
  }
  const found: string[] = [];
  const walk = async (file: string, depth: number) => {
    await rejectLinks(s.root, file);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) return;
    if (stat.isDirectory() && depth < 4)
      for (const entry of (await fs.readdir(file)).slice(0, 200)) {
        if (found.length >= 40) break;
        await walk(inside(file, entry), depth + 1);
      }
    else if (
      stat.isFile() &&
      stat.size <= 256 * 1024 &&
      /\.(json|toml|yml|yaml|cfg|conf|properties|txt)$/i.test(file)
    )
      found.push(path.relative(s.root, file).replace(/\\/g, '/'));
  };
  for (const root of roots) await walk(root, 0);
  return [...new Set(found)];
}
const secretLine = /^.*(?:password|token|secret|authkey|api[_-]?key)\s*["']?\s*[:=].*$/gim;
function masked(text: string) {
  let index = 0;
  return text.replace(secretLine, () => `__GAMEHUB_SECRET_LINE_${index++}__`);
}
export async function contentDetails(
  s: ServerRecord,
  name: string,
  source: string,
): Promise<ContentDetails> {
  await rejectLinks(s.root, source);
  const stat = await fs.stat(source);
  return {
    name,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    sha256: stat.isFile() ? await hashFile(source) : undefined,
    configs: await Promise.all(
      (await configPaths(s, name, source)).map(async (name) => ({
        name,
        text: masked(await fs.readFile(inside(s.root, name), 'utf8')),
      })),
    ),
  };
}
export async function saveContentConfig(
  s: ServerRecord,
  name: string,
  source: string,
  file: string,
  text: string,
) {
  if (
    !(await configPaths(s, name, source)).includes(file) ||
    Buffer.byteLength(text) > 256 * 1024 ||
    text.includes('\0')
  )
    throw new Error('Недопустимый файл настроек');
  const target = inside(s.root, file);
  await rejectLinks(s.root, target);
  const old = await fs.readFile(target, 'utf8'),
    secrets = old.match(secretLine) ?? [];
  // Preserve each hidden line exactly once: edits cannot accidentally erase a stored credential.
  for (let i = 0; i < secrets.length; i++)
    if (text.split(`__GAMEHUB_SECRET_LINE_${i}__`).length !== 2)
      throw new Error('Сохраните строку скрытого секрета без изменений');
  text = text.replace(/__GAMEHUB_SECRET_LINE_(\d+)__/g, (_, index) => {
    if (!secrets[Number(index)]) throw new Error('Неизвестная строка секрета');
    return secrets[Number(index)];
  });
  if (file.endsWith('.json')) JSON.parse(text);
  if (file.endsWith('.toml')) TOML.parse(text);
  await atomicWrite(target, text);
}
