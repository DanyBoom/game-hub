import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dialog, type BrowserWindow } from 'electron';
import type { ServerRecord, ContentKind, Content } from '../shared/contracts';
import { inspectZip, extractZip, hashFile } from './archives';
import { inside, rejectLinks } from './security';
const isModded = (s: ServerRecord) => ['fabric', 'forge', 'neoforge'].includes(s.core);
function contentFolder(s: ServerRecord, kind: ContentKind = 'auto') {
  if (s.game === 'beammp') return kind === 'server' ? 'Resources/Server' : 'Resources/Client';
  if (s.game === 'minecraft')
    return kind === 'datapack' ? `${s.world}/datapacks` : isModded(s) ? 'mods' : 'plugins';
  return 'content';
}
export async function listContent(s: ServerRecord): Promise<Content[]> {
  const files: Content[] = [];
  const collect = async (relative: string, prefix: string) => {
    const root = inside(s.root, relative);
    await rejectLinks(s.root, root);
    for (const e of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (e.isFile() || (s.game === 'assetto' && e.isDirectory()))
        files.push({
          name: prefix + e.name,
          bytes: e.isFile() ? (await fs.stat(inside(root, e.name))).size : 0,
          enabled: !relative.startsWith('disabled/') && !e.name.endsWith('.disabled'),
        });
    }
  };
  if (s.game === 'assetto') {
    for (const k of ['cars', 'tracks']) {
      await collect('content/' + k, k + '/');
      await collect('disabled/content/' + k, k + '/');
    }
  } else if (s.game === 'minecraft') {
    await collect(contentFolder(s), '');
    await collect(s.world + '/datapacks', 'datapacks/');
  } else if (s.game === 'beammp') {
    await collect('Resources/Client', '');
    await collect('Resources/Server', 'server/');
  }
  return files;
}
export async function importFiles(
  s: ServerRecord,
  sources: string[],
  kind: ContentKind,
  window: BrowserWindow,
  backup: () => Promise<unknown>,
) {
  if (s.game === 'acc' || s.game === 'evo')
    throw new Error(
      'Этот официальный сервер не поддерживает установку пользовательских машин/трасс ZIP. Доступный контент берётся из данных игры; настройки и участники находятся во вкладке «Все параметры».',
    );
  if (sources.length > 30) throw new Error('За один раз можно импортировать до 30 файлов');
  const plans: {
    source: string;
    name: string;
    mode: 'file' | 'world' | 'assetto' | 'lua' | 'bundle';
    folder: string;
    entries: { name: string; bytes: number }[];
  }[] = [];
  for (const source of sources) {
    const name = path.basename(source),
      extension = path.extname(name).toLowerCase();
    if (s.game === 'beammp' && kind === 'server' && extension === '.lua') {
      plans.push({
        source,
        name,
        mode: 'lua',
        folder: 'Resources/Server/' + path.basename(name, '.lua'),
        entries: [],
      });
      continue;
    }
    if (!['.zip', '.jar'].includes(extension))
      throw new Error('Поддерживаются ZIP, JAR и серверные Lua-плагины BeamMP');
    const entries = await inspectZip(source);
    if (s.game === 'beammp') {
      if (extension !== '.zip') throw new Error('Для BeamMP требуется ZIP');
      if (kind === 'server') {
        if (!entries.some((e) => e.name.endsWith('.lua'))) throw new Error('В ZIP нет Lua-плагина');
        plans.push({ source, name, mode: 'assetto', folder: 'Resources/Server', entries });
      } else {
        if (!entries.some((e) => /^(levels|vehicles)\//.test(e.name)))
          throw new Error(name + ': нет levels/ или vehicles/ в корне ZIP');
        plans.push({ source, name, mode: 'file', folder: 'Resources/Client', entries });
      }
    } else if (s.game === 'assetto') {
      if (extension !== '.zip') throw new Error('Контент AC импортируется из ZIP');
      if (entries.some((e) => /\.(exe|dll|cmd|bat|ps1|com|msi)$/i.test(e.name)))
        throw new Error('Архив AC содержит исполняемые файлы; автоматический импорт отклонён');
      let folder = '';
      if (entries.some((e) => /^content\/(cars|tracks)\//.test(e.name))) folder = '';
      else if (entries.some((e) => /^(cars|tracks)\//.test(e.name))) folder = 'content';
      else if (entries.some((e) => /^[^/]+\/(data\.acd|data\/)/.test(e.name)))
        folder = 'content/cars';
      else if (
        entries.some((e) => /^[^/]+\/(models[^/]*\.ini|[^/]+\.kn5|ui\/ui_track\.json)/.test(e.name))
      )
        folder = 'content/tracks';
      else
        throw new Error(
          'Не удалось распознать cars/tracks в ZIP. Ожидается content/cars, content/tracks или папка конкретной машины/трассы.',
        );
      plans.push({ source, name, mode: 'assetto', folder, entries });
    } else {
      if (kind === 'world' || entries.some((e) => e.name === 'level.dat')) {
        if (!entries.some((e) => e.name === 'level.dat'))
          throw new Error('В корне ZIP мира нужен level.dat');
        plans.push({ source, name, mode: 'world', folder: s.world, entries });
      } else if (kind === 'datapack' || entries.some((e) => e.name === 'pack.mcmeta')) {
        if (!entries.some((e) => e.name === 'pack.mcmeta'))
          throw new Error('В datapack нет pack.mcmeta');
        plans.push({ source, name, mode: 'file', folder: s.world + '/datapacks', entries });
      } else if (
        extension === '.zip' &&
        entries.some((e) => /^(mods|plugins)\/.*\.jar$/i.test(e.name))
      ) {
        if (s.core === 'vanilla')
          throw new Error('Набор модов требует Fabric/Forge/NeoForge или Paper для плагинов');
        const expected = s.core === 'paper' ? 'plugins' : 'mods';
        if (!entries.some((e) => e.name.startsWith(expected + '/') && e.name.endsWith('.jar')))
          throw new Error('Набор не соответствует выбранному ядру');
        if (entries.some((e) => /\.(exe|dll|cmd|bat|ps1|com|msi)$/i.test(e.name)))
          throw new Error(
            'Набор содержит исполняемые файлы Windows; автоматический импорт отклонён',
          );
        plans.push({ source, name, mode: 'bundle', folder: '', entries });
      } else {
        if (s.core === 'vanilla')
          throw new Error(
            'Vanilla принимает миры и datapacks. Для модов выберите Fabric/Forge/NeoForge, для плагинов — Paper.',
          );
        if (extension !== '.jar')
          throw new Error('Моды и плагины Minecraft должны иметь формат JAR');
        const expected =
          s.core === 'paper'
            ? /^(paper-plugin|plugin)\.yml$/
            : s.core === 'fabric'
              ? /^fabric\.mod\.json$/
              : s.core === 'neoforge'
                ? /^META-INF\/(neoforge\.)?mods\.toml$/
                : /^META-INF\/mods\.toml$/;
        if (!entries.some((e) => expected.test(e.name)))
          throw new Error(`${name}: нет метаданных для ядра ${s.core}`);
        plans.push({ source, name, mode: 'file', folder: contentFolder(s), entries });
      }
    }
  }
  const preview = await dialog.showMessageBox(window, {
    type: 'question',
    buttons: ['Отмена', 'Установить'],
    defaultId: 1,
    cancelId: 0,
    message: `Импортировать файлов: ${plans.length}?`,
    detail:
      plans
        .map(
          (p) =>
            `${p.name} → ${p.folder || 'папка сервера'}\n${p.entries
              .slice(0, 6)
              .map((e) => e.name)
              .join('\n')}`,
        )
        .join('\n\n') +
      '\nПеред изменениями будет создана копия. Миры заменяются с сохранением старой папки; моды и плагины выполняют код. Совместимость версий требует проверки.',
  });
  if (preview.response !== 1) return;
  await backup();
  let imported = 0;
  const maps: string[] = [];
  for (const plan of plans) {
    const folder = plan.folder ? inside(s.root, plan.folder) : s.root;
    await rejectLinks(s.root, folder);
    if (plan.mode === 'file' || plan.mode === 'lua') {
      await fs.mkdir(folder, { recursive: true });
      const target = inside(folder, plan.name);
      await rejectLinks(s.root, target);
      if (
        await fs
          .access(target)
          .then(() => true)
          .catch(() => false)
      ) {
        if ((await hashFile(target)) === (await hashFile(plan.source))) continue;
        await fs.rename(target, target + '.previous-' + Date.now());
      }
      await fs.copyFile(plan.source, target);
      imported++;
      for (const e of plan.entries) {
        const m = /^(levels\/[^/]+)\/info\.json$/.exec(e.name);
        if (m) maps.push('/' + m[1] + '/info.json');
      }
    } else {
      const stage = inside(s.root, '.import-' + crypto.randomUUID());
      try {
        await extractZip(plan.source, stage);
        if (plan.mode === 'world') {
          if (
            await fs
              .access(folder)
              .then(() => true)
              .catch(() => false)
          )
            await fs.rename(folder, folder + '.previous-' + Date.now());
          await fs.rename(stage, folder);
        } else {
          await fs.mkdir(folder, { recursive: true });
          if (plan.mode === 'bundle') {
            const expected =
              s.core === 'paper'
                ? /^(paper-plugin|plugin)\.yml$/
                : s.core === 'fabric'
                  ? /^fabric\.mod\.json$/
                  : s.core === 'neoforge'
                    ? /^META-INF\/(neoforge\.)?mods\.toml$/
                    : /^META-INF\/mods\.toml$/;
            for (const entry of plan.entries.filter((e) =>
              /^(mods|plugins)\/.*\.jar$/i.test(e.name),
            )) {
              const contents = await inspectZip(inside(stage, entry.name));
              if (!contents.some((e) => expected.test(e.name)))
                throw new Error(entry.name + ': метаданные не соответствуют ядру ' + s.core);
            }
          }
          for (const entry of plan.entries.filter((e) => !e.name.endsWith('/'))) {
            if (
              s.game === 'assetto' &&
              plan.folder === '' &&
              !/^content\/(cars|tracks)\//.test(entry.name)
            )
              continue;
            if (
              plan.mode === 'bundle' &&
              !/^(mods|plugins|config|defaultconfigs)\//.test(entry.name)
            )
              continue;
            const target = inside(folder, entry.name);
            await rejectLinks(s.root, target);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(inside(stage, entry.name), target);
          }
        }
        imported++;
      } finally {
        await fs.rm(stage, { recursive: true, force: true });
      }
    }
  }
  return { imported, maps, content: await listContent(s) };
}
export async function toggleFile(s: ServerRecord, name: string, backup: () => Promise<unknown>) {
  let source: string, target: string;
  if (s.game === 'assetto') {
    if (!/^(cars|tracks)\/[a-zA-Z0-9_.-]+$/.test(name))
      throw new Error('Недопустимое имя контента AC');
    const active = inside(s.root, 'content/' + name),
      disabled = inside(s.root, 'disabled/content/' + name);
    const enabled = await fs
      .access(active)
      .then(() => true)
      .catch(() => false);
    source = enabled ? active : disabled;
    target = enabled ? disabled : active;
  } else {
    let folder = contentFolder(s),
      file = name;
    if (name.startsWith('server/')) {
      folder = 'Resources/Server';
      file = name.slice(7);
    }
    if (name.startsWith('datapacks/')) {
      folder = s.world + '/datapacks';
      file = name.slice(10);
    }
    const root = inside(s.root, folder);
    source = inside(root, file);
    target = inside(root, file.endsWith('.disabled') ? file.slice(0, -9) : file + '.disabled');
  }
  await rejectLinks(s.root, source);
  await rejectLinks(s.root, target);
  if (
    await fs
      .access(target)
      .then(() => true)
      .catch(() => false)
  )
    throw new Error('Целевой файл уже существует');
  await backup();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
  return listContent(s);
}
