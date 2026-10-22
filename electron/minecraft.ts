import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ServerRecord } from '../shared/contracts';
import { download, officialJson, officialFetch } from './downloads';
import { extractZip } from './archives';
import { rejectLinks, inside, atomicWrite } from './security';
type Manifest = {
  latest: { release: string };
  versions: { id: string; type: string; url: string }[];
};
export async function minecraftVersions(core: string) {
  if (core === 'paper') {
    const p = await officialJson('https://fill.papermc.io/v3/projects/paper');
    return Object.values(p.versions)
      .flat()
      .map((id) => ({ value: String(id), label: String(id) }))
      .sort((a, b) => b.value.localeCompare(a.value, undefined, { numeric: true }));
  }
  const manifest = await officialJson<Manifest>(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  );
  return manifest.versions
    .filter((v) => v.type === 'release')
    .map((v) => ({ value: v.id, label: v.id }));
}
export async function javaFor(
  data: string,
  major: number,
  signal: AbortSignal,
  progress: (phase: string, bytes?: number, total?: number) => void,
) {
  const dir = path.join(data, 'runtimes', 'java-' + major),
    marker = path.join(dir, 'java-path.txt');
  const previous = await fs.readFile(marker, 'utf8').catch(() => '');
  if (previous) {
    const exe = inside(dir, previous);
    if (
      await fs
        .access(exe)
        .then(() => true)
        .catch(() => false)
    )
      return exe;
  }
  await fs.mkdir(dir, { recursive: true });
  await rejectLinks(dir);
  progress(`Поиск Java ${major}`);
  const list = await officialJson(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`,
  );
  const pack = list[0]?.binary?.package;
  if (!pack) throw new Error(`Не найдена Java ${major} для Windows x64`);
  const archive = path.join(dir, 'runtime.zip');
  await download(pack.link, archive, {
    hash: pack.checksum,
    size: pack.size,
    signal,
    progress: (b, t) => progress(`Скачивание Java ${major}`, b, t),
  });
  const stage = path.join(dir, 'unpack-' + Date.now());
  await extractZip(archive, stage);
  const folders = await fs.readdir(stage, { withFileTypes: true });
  const base = folders.find((f) => f.isDirectory());
  if (!base) throw new Error('Некорректный архив Java');
  const installed = path.join(dir, base.name);
  if (
    await fs
      .access(installed)
      .then(() => true)
      .catch(() => false)
  )
    await fs.rename(installed, installed + '.previous-' + Date.now());
  await fs.rename(path.join(stage, base.name), installed);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.rm(archive, { force: true });
  const relative = path.join(base.name, 'bin', 'java.exe');
  await fs.access(inside(dir, relative));
  await atomicWrite(marker, relative);
  return inside(dir, relative);
}
export async function installMinecraft(
  s: ServerRecord,
  data: string,
  signal: AbortSignal,
  progress: (phase: string, bytes?: number, total?: number) => void,
) {
  const manifest = await officialJson<Manifest>(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  );
  const version = s.version || manifest.latest.release;
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) throw new Error('Версия отсутствует в официальном каталоге Mojang');
  const meta = await officialJson(entry.url);
  let major = meta.javaVersion?.majorVersion ?? 8;
  // Current Paper may require a newer runtime than the corresponding vanilla version.
  if (s.core === 'paper' && /^(26\.|1\.21\.(?:11|[2-9]\d))/.test(version))
    major = Math.max(25, major);
  const java = await javaFor(data, major, signal, progress);
  const target = inside(s.root, 'server.jar');
  await rejectLinks(s.root, target);
  progress(`Установка ${s.core} ${version}`);
  if (s.core === 'vanilla') {
    const server = meta.downloads?.server;
    if (!server) throw new Error('Для этой версии официальный server JAR недоступен');
    await download(server.url, target, {
      algorithm: 'sha1',
      hash: server.sha1,
      size: server.size,
      signal,
      progress: (b, t) => progress('Скачивание Vanilla', b, t),
    });
  } else if (s.core === 'paper') {
    const builds = await officialJson(
      `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(version)}/builds`,
    );
    const build = builds.find((b: any) => b.channel === 'STABLE');
    const server = build?.downloads?.['server:default'];
    if (!server) throw new Error('Для выбранной версии нет стабильной сборки Paper');
    await download(server.url, target, {
      hash: server.checksums?.sha256,
      size: server.size,
      signal,
      progress: (b, t) => progress('Скачивание Paper', b, t),
    });
  } else if (s.core === 'fabric') {
    const loaders = await officialJson(
      `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`,
    );
    const loader = loaders.find((l: any) => l.loader?.stable)?.loader?.version;
    if (!loader) throw new Error('Fabric не поддерживает выбранную версию');
    const installers = await officialJson('https://meta.fabricmc.net/v2/versions/installer');
    const installer = installers.find((i: any) => i.stable)?.version ?? installers[0]?.version;
    await download(
      `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/${installer}/server/jar`,
      target,
      { signal, progress: (b, t) => progress('Скачивание Fabric', b, t) },
    );
  } else {
    let url: string, coordinate: string;
    if (s.core === 'forge') {
      const promotions = await officialJson(
        'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
      );
      const forge =
        promotions.promos[version + '-recommended'] ?? promotions.promos[version + '-latest'];
      if (!forge) throw new Error('Forge не опубликован для этой версии');
      coordinate = version + '-' + forge;
      url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${coordinate}/forge-${coordinate}-installer.jar`;
    } else {
      const response = await officialFetch(
        'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
      );
      const xml = await response.text();
      const parts = version.split('.');
      const prefix = Number(parts[1]) + '.' + (parts[2] ?? '0') + '.';
      const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map((m) => m[1])
        .filter((v) => v.startsWith(prefix) && !/[a-z]/i.test(v));
      const neo = versions.at(-1);
      if (!neo) throw new Error('NeoForge не опубликован для этой версии');
      coordinate = neo;
      url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neo}/neoforge-${neo}-installer.jar`;
    }
    const installer = inside(s.root, 'gamehub-installer.jar');
    await download(url, installer, {
      signal,
      progress: (b, t) => progress('Скачивание установщика ' + s.core, b, t),
    });
    progress('Установка библиотек ' + s.core);
    const systemKeys = new Set([
      'PATH',
      'PATHEXT',
      'SYSTEMROOT',
      'WINDIR',
      'SYSTEMDRIVE',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'PROGRAMDATA',
      'PROGRAMFILES',
      'PROGRAMFILES(X86)',
      'COMMONPROGRAMFILES',
      'COMSPEC',
      'NUMBER_OF_PROCESSORS',
      'PROCESSOR_ARCHITECTURE',
      'OS',
    ]);
    const installerEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => systemKeys.has(key.toUpperCase())),
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(java, ['-jar', installer, '--installServer'], {
        cwd: s.root,
        windowsHide: true,
        shell: false,
        stdio: 'ignore',
        signal,
        env: installerEnv,
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Установщик ядра завершился с ошибкой ' + code)),
      );
    });
    const args = inside(
      s.root,
      (s.core === 'forge'
        ? 'libraries/net/minecraftforge/forge/'
        : 'libraries/net/neoforged/neoforge/') +
        coordinate +
        '/win_args.txt',
    );
    if (
      await fs
        .access(args)
        .then(() => true)
        .catch(() => false)
    )
      await atomicWrite(
        inside(s.root, 'gamehub-launch.json'),
        JSON.stringify({ argsFile: path.relative(s.root, args), core: s.core, version }),
      );
    else if (s.core === 'forge') {
      const jar = inside(s.root, 'forge-' + coordinate + '.jar');
      await fs.access(jar);
      await atomicWrite(
        inside(s.root, 'gamehub-launch.json'),
        JSON.stringify({ jarFile: path.basename(jar), core: s.core, version }),
      );
    } else throw new Error('Не найден win_args.txt установленного ядра');
    await fs.rm(installer, { force: true });
  }
  s.version = version;
  await atomicWrite(
    inside(s.root, 'gamehub-java.json'),
    JSON.stringify({ major, core: s.core, version }),
  );
  progress('Установка завершена');
  return java;
}
export async function minecraftLaunch(s: ServerRecord, fallback?: string) {
  const java = fallback;
  if (!java) throw new Error('Сначала установите Java вместе с ядром');
  const launch = JSON.parse(
    await fs.readFile(inside(s.root, 'gamehub-launch.json'), 'utf8').catch(() => '{}'),
  );
  if (['forge', 'neoforge'].includes(s.core)) {
    if (launch.core !== s.core || launch.version !== s.version)
      throw new Error('Версия установленного ядра не соответствует настройкам');
    const file = inside(s.root, launch.jarFile ?? launch.argsFile);
    await rejectLinks(s.root, file);
    return {
      executable: java,
      args: [
        '-Xms512M',
        `-Xmx${s.memory}M`,
        ...(launch.jarFile ? ['-jar', file] : ['@' + file]),
        'nogui',
      ],
    };
  }
  return {
    executable: java,
    args: ['-Xms512M', `-Xmx${s.memory}M`, '-jar', inside(s.root, 'server.jar'), 'nogui'],
  };
}
