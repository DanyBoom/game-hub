import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { atomicWrite } from '../electron/security';
const scrypt = promisify(crypto.scrypt);
type Credential = { login: string; salt: string; hash: string };
export async function createCredentials(data: string, reset = false) {
  const file = path.join(data, 'credentials.json');
  if (
    !reset &&
    (await fs
      .access(file)
      .then(() => true)
      .catch(() => false))
  )
    return null;
  const password = crypto.randomBytes(24).toString('base64url'),
    salt = crypto.randomBytes(32).toString('hex');
  const record: Credential = {
    login: 'admin',
    salt,
    hash: ((await scrypt(password, salt, 64)) as Buffer).toString('hex'),
  };
  await atomicWrite(file, JSON.stringify(record));
  return { login: record.login, password };
}
export class Auth {
  private sessions = new Map<string, { csrf: string; expires: number }>();
  private attempts = new Map<string, { count: number; expires: number }>();
  private inflight = 0;
  constructor(private credential: Credential) {}
  static async load(data: string) {
    return new Auth(JSON.parse(await fs.readFile(path.join(data, 'credentials.json'), 'utf8')));
  }
  async login(ip: string, login: string, password: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.expires < now) this.attempts.delete(key);
    const attempt = this.attempts.get(ip) ?? { count: 0, expires: now + 15 * 60 * 1000 };
    if (attempt.count >= 8 || this.inflight >= 4 || this.attempts.size >= 10000)
      throw new Error('Слишком много попыток. Повторите позже.');
    attempt.count++;
    this.attempts.set(ip, attempt);
    this.inflight++;
    let hash: Buffer;
    try {
      hash = (await scrypt(password, this.credential.salt, 64)) as Buffer;
    } finally {
      this.inflight--;
    }
    if (
      !crypto.timingSafeEqual(hash, Buffer.from(this.credential.hash, 'hex')) ||
      login !== this.credential.login
    )
      return null;
    this.attempts.delete(ip);
    for (const [key, value] of this.sessions) if (value.expires < now) this.sessions.delete(key);
    if (this.sessions.size >= 1000) throw new Error('Слишком много сессий');
    const token = crypto.randomBytes(32).toString('base64url'),
      csrf = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(token, { csrf, expires: now + 8 * 60 * 60 * 1000 });
    return { token, csrf };
  }
  session(cookie = '') {
    const token = /(?:^|;\s*)gamehub=([a-zA-Z0-9_-]{43})(?:;|$)/.exec(cookie)?.[1];
    const session = token ? this.sessions.get(token) : undefined;
    return session && session.expires > Date.now() ? { ...session, token: token! } : null;
  }
  logout(token: string) {
    this.sessions.delete(token);
  }
}
