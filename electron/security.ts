import path from 'node:path';
import fs from 'node:fs/promises';
export function inside(root: string, relative: string): string {
  if (
    !relative ||
    relative.includes('\0') ||
    relative.includes(':') ||
    /[\\/]/.test(relative[0]) ||
    relative
      .split(/[\\/]/)
      .some(
        (p) =>
          p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p),
      )
  )
    throw new Error('Небезопасный путь');
  const target = path.resolve(root, relative);
  const rel = path.relative(path.resolve(root), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel))
    throw new Error('Путь вне папки сервера');
  return target;
}
export async function rejectLinks(root: string, target = root): Promise<void> {
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Путь вне папки сервера');
  let current = root;
  for (const part of ['', ...rel.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const st = await fs.lstat(current).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (st?.isSymbolicLink()) throw new Error('Ссылки и junction в управляемых папках запрещены');
  }
}
export function redact(text: string, secrets: string[] = []): string {
  let value = text;
  for (const secret of secrets.filter(Boolean)) value = value.split(secret).join('[SECRET]');
  value = value.replace(
    /((?:AuthKey|password|token|secret|rcon\.password)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    '$1[SECRET]',
  );
  value = value.replace(/[A-Z]:[\\/]Users[\\/][^\\/\s"']+/gi, '%USERPROFILE%');
  value = value.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]');
  return value.slice(0, 4000);
}
export async function atomicWrite(file: string, content: string | Uint8Array) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, content, { mode: 0o600 });
  await fs.rename(tmp, file);
}
