import crypto from 'node:crypto';
import path from 'node:path';
let root = '',
  key: Buffer;
export function configurePlatform(data: string, secret: Buffer) {
  root = data;
  key = secret;
}
export const app = { isPackaged: false, getVersion: () => '0.4.0', getPath: () => root };
export const safeStorage = {
  isEncryptionAvailable: () => !!key,
  encryptString(value: string) {
    const iv = crypto.randomBytes(12),
      cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  },
  decryptString(value: Buffer) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(-16));
    return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString(
      'utf8',
    );
  },
};
export const dialog = {
  async showMessageBox() {
    return { response: 1, checkboxChecked: false };
  },
  async showOpenDialog() {
    throw new Error('Используйте загрузку файлов в веб-панели');
  },
};
export const shell = {
  async openExternal() {
    throw new Error('Откройте ссылку в браузере');
  },
  async openPath(value: string) {
    return path.resolve(value);
  },
};
