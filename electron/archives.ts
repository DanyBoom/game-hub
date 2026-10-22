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
        if (entry.isDirectory()) await walk(full);
        else if (
          entry.isFile() &&
          !/\.(exe|dll|jar|log|tmp)$/i.test(entry.name) &&
          !/^(logs|cache|libraries|versions)\//i.test(relative)
        ) {
          if (relative === 'ServerConfig.toml') {
            const data = TOML.parse(await fs.readFile(full, 'utf8'));
            const general = data.General as Record<string, any>;
            if (general) general.AuthKey = '';
            zip.addBuffer(Buffer.from(TOML.stringify(data)), relative);
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
