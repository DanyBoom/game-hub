import fs from 'node:fs/promises';
import crypto from 'node:crypto';
export const userAgent = 'GameHub/0.2 (https://github.com/DanyBoom/game-hub)';
const hosts = new Set([
  'piston-meta.mojang.com',
  'launchermeta.mojang.com',
  'piston-data.mojang.com',
  'launcher.mojang.com',
  'fill.papermc.io',
  'fill-data.papermc.io',
  'api.papermc.io',
  'meta.fabricmc.net',
  'maven.fabricmc.net',
  'files.minecraftforge.net',
  'maven.minecraftforge.net',
  'maven.neoforged.net',
  'api.adoptium.net',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
export function trustedUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password)
    throw new Error('Недоверенный адрес загрузки');
  return url.href;
}
export async function officialFetch(url: string, signal?: AbortSignal): Promise<Response> {
  let target = trustedUrl(url);
  for (let redirects = 0; redirects < 6; redirects++) {
    const response = await fetch(target, {
      headers: { 'User-Agent': userAgent },
      redirect: 'manual',
      signal: signal ?? AbortSignal.timeout(30000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Пустой redirect');
      target = trustedUrl(new URL(location, target).href);
      continue;
    }
    if (!response.ok) throw new Error(`Официальный сервис ответил HTTP ${response.status}`);
    return response;
  }
  throw new Error('Слишком много перенаправлений');
}
export async function officialJson<T = any>(url: string): Promise<T> {
  const r = await officialFetch(url);
  const text = await r.text();
  if (text.length > 8 * 1024 ** 2) throw new Error('Метаданные слишком велики');
  return JSON.parse(text);
}
export async function download(
  url: string,
  file: string,
  options: {
    algorithm?: 'sha1' | 'sha256';
    hash?: string;
    size?: number;
    signal?: AbortSignal;
    progress?: (bytes: number, total?: number) => void;
    limit?: number;
  } = {},
) {
  const response = await officialFetch(url, options.signal);
  if (!response.body) throw new Error('Пустая загрузка');
  const temporary = file + '.download';
  const output = await fs.open(temporary, 'wx');
  let bytes = 0;
  const hash = crypto.createHash(options.algorithm ?? 'sha256');
  const total = options.size ?? (Number(response.headers.get('content-length') || 0) || undefined);
  try {
    for await (const chunk of response.body as any) {
      bytes += chunk.length;
      if (bytes > (options.limit ?? 512 * 1024 ** 2)) throw new Error('Превышен размер загрузки');
      hash.update(chunk);
      await output.write(chunk);
      options.progress?.(bytes, total);
    }
    await output.close();
    if (options.size && bytes !== options.size) throw new Error('Неполная загрузка');
    const digest = hash.digest('hex');
    if (options.hash && digest.toLowerCase() !== options.hash.toLowerCase())
      throw new Error('Контрольная сумма не совпала');
    await fs.rename(temporary, file);
    return digest;
  } catch (error) {
    await output.close().catch(() => {});
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
