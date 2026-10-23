import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import TOML from '@iarna/toml';
import { inside, rejectLinks } from './security';
export type ArchiveEntry = { name: string; bytes: number };
export async function inspectZip(file: string): Promise<ArchiveEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Некорректный ZIP'));
      const entries: ArchiveEntry[] = [];
      let total = 0;
      const seen = new Set<string>();
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', (e) => {
        try {
          inside(path.resolve('archive-root'), e.fileName.replace(/\/$/, ''));
          if (e.generalPurposeBitFlag & 1) throw new Error('Зашифрованный ZIP не поддерживается');
          const mode = (e.externalFileAttributes >>> 16) & 0xf000;
          if (mode === 0xa000) throw new Error('Символьные ссылки запрещены');
          const key = e.fileName.toLowerCase();
          if (seen.has(key)) throw new Error('Дублирующиеся пути в ZIP');
          seen.add(key);
          total += e.uncompressedSize;
          if (
            total > 4 * 1024 ** 3 ||
            entries.length >= 20000 ||
            e.uncompressedSize > 1024 ** 3 ||
            (e.compressedSize > 0 && e.uncompressedSize / e.compressedSize > 1000)
          )
            throw new Error('Архив превышает безопасные ограничения');
          entries.push({ name: e.fileName, bytes: e.uncompressedSize });
          zip.readEntry();
        } catch (error) {
          zip.close();
          reject(error);
        }
      });
      zip.readEntry();
    });
  });
}
export async function extractZip(file: string, root: string) {
  await inspectZip(file);
  await fs.mkdir(root, { recursive: true });
  await rejectLinks(root);
  await new Promise<void>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', async (e) => {
        try {
          const dest = inside(root, e.fileName.replace(/\/$/, ''));
          await rejectLinks(root, dest);
          if (e.fileName.endsWith('/')) {
            await fs.mkdir(dest, { recursive: true });
            zip.readEntry();
            return;
          }
          await fs.mkdir(path.dirname(dest), { recursive: true });
          zip.openReadStream(e, async (error, stream) => {
            if (error || !stream) {
              zip.close();
              reject(error);
              return;
            }
            try {
              await pipeline(stream, createWriteStream(dest, { flags: 'wx' }));
              zip.readEntry();
            } catch (error) {
              zip.close();
              reject(error);
            }
          });
        } catch (error) {
          zip.close();
          reject(error);
        }
      });
      zip.readEntry();
    }),
  );
}
export async function hashFile(file: string) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function zipFolder(root: string, target: string) {
  const game = await fs
    .readFile(path.join(root, 'gamehub-settings.json'), 'utf8')
    .then(JSON.parse)
    .then((v) => v.game)
    .catch(() => '');
  const excluded =
    game === 'factorio'
      ? /^(bin|data|doc|temp)(\/|$)/
      : game === 'valheim'
        ? /^(valheim_server_Data|linux64|MonoBleedingEdge|UnityPlayer)(\/|$)/
        : game === 'terraria'
          ? /^(Content|Libraries|DotNet|Windows|Linux|Mac)(\/|$)/
          : /$a/;
  const zip = new yazl.ZipFile();
  const output = createWriteStream(target, { flags: 'wx' });
  const finished = pipeline(zip.outputStream, output);
  // Attach a rejection handler before asynchronous traversal starts.
  finished.catch(() => {});
  try {
    const walk = async (dir: string) => {
      await rejectLinks(root, dir);
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        await rejectLinks(root, full);
        const relative = path.relative(root, full).replace(/\\/g, '/');
        if (
          relative === 'hub-sign.key' ||
          relative === 'nightcoop_hub' ||
          relative.startsWith('.nightcoop-build-')
        )
          continue;
        if (
          excluded.test(relative) ||
          /(?:^|\/)(BeamMP-Server|valheim_server\.x86_64|TerrariaServer(?:\.bin\.x86_64)?|lib[^/]+\.so(?:\.\d+)*)$/.test(
            relative,
          )
        )
          continue;
        if (entry.isDirectory()) {
          if (
            !/^(logs|log|cache|libraries|versions)(\/|$)/i.test(relative) &&
            !entry.name.startsWith('.import-')
          )
            await walk(full);
        } else if (
          entry.isFile() &&
          !/\.(exe|dll|kspkg|log|tmp)$/i.test(entry.name) &&
          entry.name !== 'server.jar' &&
          entry.name !== 'gamehub-installer.jar' &&
          !/^(logs|cache|libraries|versions)\//i.test(relative)
        ) {
          if (relative === 'ServerConfig.toml') {
            const data = TOML.parse(await fs.readFile(full, 'utf8'));
            const general = data.General as Record<string, any>;
            if (general) general.AuthKey = '';
            zip.addBuffer(Buffer.from(TOML.stringify(data)), relative);
          } else if (
            /^(cfg\/.*\.json|server_config\.json|season_config\.json|server-settings\.json)$/i.test(
              relative,
            )
          ) {
            const bytes = await fs.readFile(full);
            const utf16 = bytes[0] === 255 && bytes[1] === 254;
            const text = utf16
              ? bytes.subarray(2).toString('utf16le')
              : bytes.toString('utf8').replace(/^\uFEFF/, '');
            const scrub = (v: any): any =>
              Array.isArray(v)
                ? v.map(scrub)
                : v && typeof v === 'object'
                  ? Object.fromEntries(
                      Object.entries(v).map(([k, val]) => [
                        k,
                        /password|authkey|token|secret/i.test(k) ? '' : scrub(val),
                      ]),
                    )
                  : v;
            const clean = JSON.stringify(scrub(JSON.parse(text)), null, 2);
            zip.addBuffer(
              utf16
                ? Buffer.concat([Buffer.from([255, 254]), Buffer.from(clean, 'utf16le')])
                : Buffer.from(clean),
              relative,
            );
          } else if (relative === 'cfg/server_cfg.ini' || relative === 'serverconfig.txt') {
            zip.addBuffer(
              Buffer.from(
                (await fs.readFile(full, 'utf8')).replace(
                  /^(\s*(?:PASSWORD|ADMIN_PASSWORD)\s*=).*$/gim,
                  '$1',
                ),
              ),
              relative,
            );
          } else zip.addFile(full, relative);
        }
      }
    };
    await walk(root);
    zip.end();
    await finished;
  } catch (error) {
    zip.end();
    output.destroy();
    await finished.catch(() => {});
    await fs.rm(target, { force: true });
    throw error;
  }
}
