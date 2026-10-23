import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import pidusage from 'pidusage';
import type { BrowserWindow } from 'electron';
import { app, dialog, safeStorage, shell } from './platform';
import { Store } from './store';
import { binaryName, configure, readConfig } from './adapters';
import { atomicWrite, inside, redact, rejectLinks } from './security';
import { extractZip, hashFile, inspectZip, zipFolder } from './archives';
import { games } from '../shared/catalog';
import {
  racingGames,
  gameOptions,
  configDocuments,
  configurationFiles,
  saveConfigDocument,
  evoArguments,
  readJson,
  writeJson,
  patchIni,
  parseIni,
} from './racing';
import { detectTool, copyTool, requestSteamInstall } from './steam';
import { installMinecraft, minecraftLaunch, minecraftVersions } from './minecraft';
import { download, officialJson } from './downloads';
import type { ContentKind } from '../shared/contracts';
import { listContent, importFiles, toggleFile } from './content';
import { extraGames, installExtra, extraLaunch, runTool } from './extra-games';
import { actualContentPath, contentDetails, saveContentConfig } from './content-settings';
import {
  serverInput,
  type ServerRecord,
  type ServerInput,
  type LogLine,
  type Backup,
  type Check,
  type Stats,
} from '../shared/contracts';

type Running = {
  worker: ChildProcess;
  pid?: number;
  stopping: boolean;
  exited: Promise<void>;
  finish: () => void;
};
export class Manager {
  private installs = new Map<string, AbortController>();
  readonly servers = new Map<string, ServerRecord>();
  readonly running = new Map<string, Running>();
  private logs = new Map<string, LogLine[]>();
  private cpu = 0;
  private cpuSample = os.cpus().map((c) => c.times);
  private timer?: NodeJS.Timeout;
  private journalQueue: Promise<void> = Promise.resolve();
  private fileLogOffsets = new Map<string, number>();
  constructor(
    readonly store: Store,
    private data: string,
    private window: () => BrowserWindow,
  ) {}
  async init() {
    for (const s of this.store.all()) {
      const parsed = serverInput.parse(
        Object.fromEntries(
          Object.keys(serverInput.shape)
            .filter((k) => !['authKey', 'password', 'adminPassword'].includes(k))
            .map((k) => [k, (s as any)[k]]),
        ),
      );
      Object.assign(s, parsed);
      s.installation = undefined;
      this.servers.set(s.id, s);
      await this.refreshInstalled(s);
    }
    // Crash journals are diagnostic only. Never trust a saved PID for kill/attach.
    const journal = await fs
      .readFile(path.join(this.data, 'process-journal.json'), 'utf8')
      .catch(() => '[]');
    for (const previous of JSON.parse(journal)) {
      const s = this.servers.get(previous.id);
      if (!s) continue;
      try {
        process.kill(previous.pid, 0);
        s.lastError =
          'После сбоя найден прежний PID. Проверьте процесс в Диспетчере задач до запуска; PID мог быть переиспользован.';
        s.status = 'error';
      } catch {}
    }
    this.timer = setInterval(() => void this.measure(), 3000);
    this.timer.unref();
  }
  private async measure() {
    const current = os.cpus().map((c) => c.times);
    let idle = 0,
      total = 0;
    current.forEach((c, i) => {
      const p = this.cpuSample[i];
      if (!p) return;
      idle += c.idle - p.idle;
      total +=
        Object.values(c).reduce((a, b) => a + b, 0) - Object.values(p).reduce((a, b) => a + b, 0);
    });
    this.cpu = total ? Math.max(0, Math.min(100, 100 * (1 - idle / total))) : 0;
    this.cpuSample = current;
    for (const [id, r] of this.running)
      if (r.pid) {
        try {
          const p = await pidusage(r.pid);
          const s = this.get(id);
          s.memoryMB = Math.round(p.memory / 1024 ** 2);
          s.cpu = Math.round(p.cpu * 10) / 10;
        } catch {}
        if (this.get(id).game === 'acc') await this.tailAccLog(this.get(id));
      }
  }
  private async tailAccLog(s: ServerRecord) {
    try {
      const file = inside(s.root, 'log/server.log');
      await rejectLinks(s.root, file);
      const stat = await fs.stat(file);
      let offset = this.fileLogOffsets.get(s.id) ?? 0;
      if (stat.size < offset) offset = 0;
      if (stat.size === offset) return;
      const fd = await fs.open(file, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(stat.size - offset, 65536));
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, offset);
        const last = buffer.subarray(0, bytesRead).lastIndexOf(10);
        if (last < 0) {
          if (bytesRead === 65536) {
            this.fileLogOffsets.set(s.id, stat.size);
            this.log(s.id, 'Слишком длинная строка лога ACC пропущена');
          }
          return;
        }
        this.fileLogOffsets.set(s.id, offset + last + 1);
        const secrets = await this.passwords(s);
        this.log(s.id, buffer.subarray(0, last + 1).toString('utf8'), 'out', [
          secrets.password ?? '',
          secrets.adminPassword ?? '',
        ]);
      } finally {
        await fd.close();
      }
    } catch {}
  }
  async stats(): Promise<Stats> {
    const root =
      this.store.getSetting('root') ?? path.join(app.getPath('documents'), 'GameHub Servers');
    const disk = await fs
      .statfs(
        await fs
          .access(root)
          .then(() => root)
          .catch(() => this.data),
      )
      .catch(() => null);
    return {
      totalMB: Math.round(os.totalmem() / 1024 ** 2),
      freeMB: Math.round(os.freemem() / 1024 ** 2),
      cpu: this.cpu,
      freeDiskGB: disk ? Math.round((disk.bavail * disk.bsize) / 1024 ** 3) : null,
      addresses: Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a?.family === 'IPv4' && !a.internal)
        .map((a) => a!.address),
      root,
    };
  }
  async snapshot() {
    return {
      servers: [...this.servers.values()],
      stats: await this.stats(),
      games: games.map((g) =>
        g.id === 'factorio' && process.platform === 'win32'
          ? { ...g, support: 'planned' as const }
          : process.platform !== 'win32' && racingGames.has(g.id)
            ? { ...g, support: 'planned' as const }
            : g,
      ),
      version: app.getVersion(),
      platform: process.platform,
    };
  }
  get(id: string) {
    const s = this.servers.get(id);
    if (!s) throw new Error('Сервер не найден');
    return s;
  }
  private stopped(s: ServerRecord) {
    if (this.installs.has(s.id)) throw new Error('Дождитесь установки или отмените её');
    if (this.running.has(s.id))
      throw new Error('Сначала остановите сервер и дождитесь завершения.');
    if (s.lastError?.startsWith('После сбоя')) throw new Error(s.lastError);
  }
  async setRoot() {
    const picked = await dialog.showOpenDialog(this.window(), {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Папка для новых серверов',
    });
    if (!picked.canceled) {
      await rejectLinks(picked.filePaths[0]);
      await this.store.setting('root', picked.filePaths[0]);
    }
    return this.stats();
  }
  async create(input: ServerInput) {
    const { authKey, password, adminPassword, ...values } = serverInput.parse(input);
    if (values.game === 'valheim') values.players = 10;
    if ([...this.servers.values()].some((s) => s.port === values.port))
      throw new Error('Этот порт уже назначен другому серверу GameHub');
    const id = crypto.randomUUID();
    const root = path.join((await this.stats()).root, id);
    await fs.mkdir(root, { recursive: true });
    await rejectLinks(root);
    const s: ServerRecord = {
      ...values,
      id,
      root,
      createdAt: new Date().toISOString(),
      status: 'stopped',
      hasSecret: false,
      installed: false,
    };
    if (authKey) await this.saveSecret(s, authKey);
    await this.savePasswords(s, password, adminPassword);
    await configure(s, authKey ?? '', await this.passwords(s));
    await this.store.put(s);
    this.servers.set(id, s);
    return s;
  }
  async update(id: string, input: ServerInput) {
    const s = this.get(id);
    this.stopped(s);
    const { authKey, password, adminPassword, ...values } = serverInput.parse(input);
    if (values.game === 'valheim') values.players = 10;
    if (values.game !== s.game) throw new Error('Нельзя менять игру существующего сервера');
    if ([...this.servers.values()].some((v) => v.id !== id && v.port === values.port))
      throw new Error('Конфликт порта с другим сервером');
    await this.backup(id);
    if (authKey) await this.saveSecret(s, authKey);
    await this.savePasswords(s, password, adminPassword);
    const next = { ...s, ...values };
    await configure(next, await this.secret(s), await this.passwords(s));
    await this.store.put(next);
    this.servers.set(id, next);
    return next;
  }
  private async saveSecret(s: ServerRecord, value: string) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Windows DPAPI недоступен: ключ не будет сохранён');
    await this.store.setting(`secret:${s.id}`, safeStorage.encryptString(value).toString('base64'));
    s.hasSecret = !!value;
  }
  private async secret(s: ServerRecord) {
    const value = this.store.getSetting(`secret:${s.id}`);
    return value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : '';
  }
  private async savePasswords(s: ServerRecord, password?: string, adminPassword?: string) {
    for (const [key, value] of Object.entries({ password, adminPassword }))
      if (value) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('DPAPI недоступен');
        await this.store.setting(
          `${key}:${s.id}`,
          safeStorage.encryptString(value).toString('base64'),
        );
      }
  }
  private async passwords(s: ServerRecord) {
    const result: { password?: string; adminPassword?: string } = {};
    for (const key of ['password', 'adminPassword'] as const) {
      const value = this.store.getSetting(`${key}:${s.id}`);
      if (value) result[key] = safeStorage.decryptString(Buffer.from(value, 'base64'));
    }
    return result;
  }
  async options(id: string) {
    const values = serverInput.parse({
      game: this.servers.get(id)?.game ?? id,
      name: 'Draft',
      port: 30814,
      players: 8,
    });
    const s = this.servers.get(id) ?? {
      ...values,
      id: 'draft',
      root: (await detectTool(values.game)) ?? path.join(this.data, 'draft'),
      createdAt: '',
      hasSecret: false,
      installed: false,
      status: 'stopped' as const,
    };
    const result = await gameOptions(s);
    if (s.game === 'beammp')
      for (const name of await fs.readdir(path.join(s.root, 'Resources/Client')).catch(() => []))
        if (name.endsWith('.zip')) {
          const file = inside(s.root, 'Resources/Client/' + name);
          await rejectLinks(s.root, file);
          for (const entry of await inspectZip(file).catch(() => [])) {
            const match = /^levels\/([^/]+)\/info\.json$/.exec(entry.name);
            if (match) {
              const value = '/levels/' + match[1] + '/info.json';
              if (!result.maps.some((m) => m.value === value))
                result.maps.push({ value, label: match[1] + ' · ' + name });
            }
          }
        }
    return result;
  }
  versions(core: string) {
    return minecraftVersions(core);
  }
  documents(id: string) {
    return configDocuments(this.get(id));
  }
  async saveDocument(id: string, name: string, data: Record<string, unknown>) {
    const s = this.get(id);
    this.stopped(s);
    if (!(await configurationFiles(s)).includes(name))
      throw new Error('Недопустимый конфигурационный файл');
    await this.backup(id);
    const originalFile = inside(s.root, name);
    await rejectLinks(s.root, originalFile);
    const original = await fs.readFile(originalFile);
    let changed: Partial<ServerRecord>;
    try {
      await saveConfigDocument(s, name, data);
      changed = await readConfig(s);
      const candidate = { ...s, ...changed, game: s.game };
      serverInput.parse(
        Object.fromEntries(
          Object.keys(serverInput.shape).map((key) => [key, (candidate as any)[key]]),
        ),
      );
    } catch (error) {
      await atomicWrite(originalFile, original);
      throw error;
    }
    const raw = data as any;
    if (
      s.game === 'beammp' &&
      typeof raw.General?.AuthKey === 'string' &&
      raw.General.AuthKey !== '__GAMEHUB_KEEP_SECRET__'
    )
      await this.saveSecret(s, raw.General.AuthKey);
    const candidates =
      s.game === 'assetto'
        ? { password: raw.SERVER?.PASSWORD, adminPassword: raw.SERVER?.ADMIN_PASSWORD }
        : s.game === 'evo'
          ? { password: raw.driver_password, adminPassword: raw.admin_password }
          : { password: raw.game_password ?? raw.password, adminPassword: raw.adminPassword };
    for (const [key, value] of Object.entries(candidates))
      if (typeof value === 'string' && value !== '__GAMEHUB_KEEP_SECRET__') {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('DPAPI недоступен');
        await this.store.setting(
          `${key}:${s.id}`,
          safeStorage.encryptString(value).toString('base64'),
        );
      }
    Object.assign(s, changed);
    await this.store.put(s);
    this.log(id, 'Сохранён ' + name);
    return this.documents(id);
  }
  cancelInstall(id: string) {
    this.get(id);
    this.installs.get(id)?.abort();
  }
  get installing() {
    return this.installs.size > 0;
  }
  async cancelAllInstalls() {
    for (const controller of this.installs.values()) controller.abort();
    for (let i = 0; i < 100 && this.installs.size; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (this.installs.size)
      throw new Error('Установщик ещё завершает работу. Повторите выход после остановки.');
  }
  private async refreshInstalled(s: ServerRecord) {
    s.installed = await fs
      .access(
        path.join(
          s.root,
          s.game === 'minecraft' && ['forge', 'neoforge'].includes(s.core)
            ? 'gamehub-launch.json'
            : binaryName(s),
        ),
      )
      .then(() => true)
      .catch(() => false);
    if (s.game === 'minecraft' && s.installed) {
      const installed = await fs
        .readFile(inside(s.root, 'gamehub-java.json'), 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => null);
      if (installed?.core && (installed.core !== s.core || installed.version !== s.version))
        s.installed = false;
    }
  }
  private log(
    id: string,
    text: string,
    stream: LogLine['stream'] = 'system',
    secrets: string[] = [],
  ) {
    const lines = this.logs.get(id) ?? [];
    for (const value of text.split(/\r?\n/).filter(Boolean))
      lines.push({ time: new Date().toISOString(), text: redact(value, secrets), stream });
    this.logs.set(id, lines.slice(-600));
  }
  getLogs(id: string) {
    this.get(id);
    return this.logs.get(id) ?? [];
  }
  async ports(s: ServerRecord): Promise<Check[]> {
    const tcp = await new Promise<boolean>((resolve) => {
      const socket = net.createServer();
      socket.unref();
      socket.once('error', () => resolve(false));
      socket.listen({ host: '0.0.0.0', port: s.port, exclusive: true }, () =>
        socket.close(() => resolve(true)),
      );
    });
    const checks = [
      {
        label: `TCP ${s.port}`,
        ok: tcp,
        detail: tcp ? 'Свободен на момент проверки' : 'Занят или недоступен',
      },
    ];
    if (s.game !== 'minecraft') {
      const udp = await new Promise<boolean>((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.unref();
        socket.once('error', () => {
          socket.close();
          resolve(false);
        });
        socket.bind(s.port, '0.0.0.0', () => socket.close(() => resolve(true)));
      });
      if (s.game === 'valheim')
        checks.push({
          label: 'Пароль Valheim',
          ok: ((await this.passwords(s)).password?.length ?? 0) >= 5,
          detail: 'Нужно не менее 5 символов; порт и следующий UDP-порт должны быть доступны.',
        });
      checks.push({
        label: `UDP ${s.port}`,
        ok: udp,
        detail: udp ? 'Свободен на момент проверки' : 'Занят или недоступен',
      });
    }
    if (s.game === 'valheim') {
      const next =
        s.port < 65535 &&
        (await new Promise<boolean>((resolve) => {
          const socket = dgram.createSocket('udp4');
          socket.once('error', () => {
            socket.close();
            resolve(false);
          });
          socket.bind(s.port + 1, '0.0.0.0', () => socket.close(() => resolve(true)));
        }));
      checks.push({
        label: `UDP ${s.port + 1}`,
        ok: !!next,
        detail: next ? 'Свободен на момент проверки' : 'Следующий UDP-порт занят или вне диапазона',
      });
    }
    if (['assetto', 'evo'].includes(s.game)) {
      const free =
        s.httpPort !== s.port &&
        (await new Promise<boolean>((resolve) => {
          const server = net.createServer();
          server.unref();
          server.once('error', () => resolve(false));
          server.listen({ host: '0.0.0.0', port: s.httpPort, exclusive: true }, () =>
            server.close(() => resolve(true)),
          );
        }));
      checks.push({
        label: `HTTP TCP ${s.httpPort}`,
        ok: free,
        detail: free ? 'Свободен' : 'HTTP-порт занят или совпадает с игровым портом',
      });
    }
    return checks;
  }
  async freePort() {
    for (let i = 0; i < 20; i++) {
      const candidate = await new Promise<number>((resolve, reject) => {
        const listener = net.createServer();
        listener.once('error', reject);
        listener.listen(0, '0.0.0.0', () => {
          const port = (listener.address() as net.AddressInfo).port;
          listener.close(() => resolve(port));
        });
      });
      if (
        candidate >= 65535 ||
        [...this.servers.values()].some((s) => [s.port, s.port + 1, s.httpPort].includes(candidate))
      )
        continue;
      const available = await new Promise<boolean>((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.once('error', () => {
          socket.close();
          resolve(false);
        });
        socket.bind(candidate, '0.0.0.0', () => socket.close(() => resolve(true)));
      });
      if (available) return candidate;
    }
    throw new Error('Не удалось подобрать свободный порт');
  }
  async diagnose(id: string) {
    const s = this.get(id);
    await rejectLinks(s.root);
    await this.refreshInstalled(s);
    const checks: Check[] = [
      {
        label: 'Серверные файлы',
        ok: s.installed,
        detail: s.installed ? binaryName(s) : 'Установите или импортируйте сервер',
      },
    ];
    if (s.game === 'beammp')
      checks.push({
        label: 'AuthKey',
        ok: !!(await this.secret(s)),
        detail: s.hasSecret
          ? 'Ключ сохранён в защищённом хранилище'
          : 'Получите ключ на keymaster.beammp.com',
      });
    if (s.game === 'minecraft') {
      checks.push({
        label: 'Лицензионное соглашение',
        ok: s.eula,
        detail: 'Принимается только явной отметкой пользователя',
      });
      const java = this.store.getSetting(`java:${s.id}`) ?? this.store.getSetting('java');
      checks.push({
        label: 'Java',
        ok:
          !!java &&
          (await fs
            .access(java)
            .then(() => true)
            .catch(() => false)),
        detail:
          'Java устанавливается автоматически вместе с ядром; при необходимости можно выбрать свою.',
      });
      checks.push({
        label: 'Оперативная память',
        ok: s.memory < os.freemem() / 1024 ** 2,
        detail: `Выделено ${s.memory} МБ; доступно ${Math.round(os.freemem() / 1024 ** 2)} МБ`,
      });
    }
    if (racingGames.has(s.game)) {
      checks.push({
        label: 'Трасса',
        ok: !!s.track,
        detail: s.track || 'Выберите трассу в настройках',
      });
      if (s.game === 'assetto')
        checks.push({
          label: 'Автомобили',
          ok: s.cars.length > 0,
          detail: 'Выберите хотя бы один автомобиль',
        });
      if (s.game === 'evo')
        checks.push({
          label: 'Официальная конфигурация EVO',
          ok: await fs
            .access(path.join(s.root, 'server_config.json'))
            .then(() => true)
            .catch(() => false),
          detail: 'Используется отдельная JSON-конфигурация официального сервера EVO',
        });
    }
    if (!this.running.has(id)) checks.push(...(await this.ports(s)));
    return checks;
  }
  async start(id: string) {
    const s = this.get(id);
    this.stopped(s);
    if (this.running.size >= 3) throw new Error('Лимит: три одновременно работающих сервера');
    const checks = await this.diagnose(id);
    if (checks.some((c) => !c.ok))
      throw new Error(
        checks
          .filter((c) => !c.ok)
          .map((c) => c.label + ': ' + c.detail)
          .join('\n'),
      );
    const secret = await this.secret(s);
    this.fileLogOffsets.delete(id);
    const passwords = await this.passwords(s);
    // Settings are written on explicit save; preserve edits made in the full configuration editor.
    const binary = inside(s.root, binaryName(s));
    await rejectLinks(s.root, binary);
    let executable = binary,
      args: string[] = [];
    if (s.game === 'minecraft') {
      const launch = await minecraftLaunch(
        s,
        this.store.getSetting(`java:${s.id}`) ?? this.store.getSetting('java'),
      );
      executable = launch.executable;
      args = launch.args;
    }
    if (s.game === 'evo') args = await evoArguments(s);
    if (extraGames.has(s.game)) args = extraLaunch(s, passwords.password ?? '');
    if (
      process.platform === 'win32' &&
      (racingGames.has(s.game) || ['valheim', 'terraria'].includes(s.game))
    ) {
      args = [...(s.game === 'terraria' ? ['--console-input'] : []), executable, ...args];
      executable = app.isPackaged
        ? path.join(process.resourcesPath, 'ConsoleHost.exe')
        : path.join(__dirname, 'ConsoleHost.exe');
      await fs.access(executable);
    }
    const worker = fork(path.join(__dirname, 'runner.cjs'), [], {
      execPath: process.execPath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        HOME: s.root,
        ...(s.game === 'valheim'
          ? { SteamAppId: '892970', LD_LIBRARY_PATH: path.join(s.root, 'linux64') }
          : {}),
        GAMEHUB_STOP:
          s.game === 'terraria' && process.platform === 'win32'
            ? 'console-exit'
            : racingGames.has(s.game) || s.game === 'valheim'
              ? process.platform === 'win32'
                ? 'native'
                : 'signal'
              : s.game === 'factorio'
                ? 'signal'
                : s.game === 'minecraft'
                  ? 'stop'
                  : 'exit',
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    let finish!: () => void;
    const exited = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const running: Running = { worker, stopping: false, exited, finish };
    this.running.set(id, running);
    s.status = 'running';
    s.lastError = undefined;
    const failed = (text: string) => {
      s.status = 'error';
      s.lastError = text;
      this.log(id, text, 'error');
    };
    worker.on(
      'message',
      async (message: {
        type: string;
        pid?: number;
        text?: string;
        stream?: 'out' | 'error';
        code?: number;
      }) => {
        if (message.type === 'pid') {
          running.pid = message.pid;
          s.pid = message.pid;
          await this.journal();
        } else if (message.type === 'log')
          this.log(id, message.text ?? '', message.stream, [
            secret,
            passwords.password ?? '',
            passwords.adminPassword ?? '',
          ]);
        else if (message.type === 'failed')
          failed('Не удалось запустить сервер. Проверьте файлы и зависимости.');
        else if (message.type === 'exit') {
          if (!running.stopping && message.code !== 0)
            failed(`Процесс завершился с кодом ${message.code}. Откройте консоль и диагностику.`);
          else s.status = 'stopped';
        }
      },
    );
    worker.once('error', () => failed('Ошибка процесса управления сервером'));
    worker.once('exit', () => {
      this.running.delete(id);
      s.pid = undefined;
      s.memoryMB = undefined;
      s.cpu = undefined;
      if (s.status !== 'error') s.status = 'stopped';
      finish();
      void this.journal();
    });
    worker.send({ type: 'start', executable, args, cwd: s.root });
    this.log(id, 'Запрошен запуск процесса. Готовность игры проверяйте по консоли.');
    return s;
  }
  async stop(id: string) {
    const s = this.get(id),
      r = this.running.get(id);
    if (!r) return;
    if (!r.stopping) {
      r.stopping = true;
      s.status = 'stopping';
      r.worker.send({ type: 'stop' });
      this.log(id, 'Отправлена штатная команда остановки. Ожидаем сохранения и выхода.');
    }
    const done = await Promise.race([
      r.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 30000);
        t.unref();
      }),
    ]);
    if (!done)
      throw new Error(
        'Сервер ещё останавливается. Принудительное завершение не выполнено: проверьте консоль.',
      );
    if (s.game === 'acc') await this.tailAccLog(s);
  }
  command(id: string, command: string) {
    const s = this.get(id),
      r = this.running.get(id);
    if (!r || r.stopping) throw new Error('Сервер не запущен');
    if (racingGames.has(s.game))
      throw new Error(
        'Команды администратора этой игры отправляются из игрового чата. Консоль GameHub показывает реальные логи.',
      );
    if (s.game === 'beammp' && /^lua\b/i.test(command))
      throw new Error(
        'Lua-режим через консоль GameHub отключён: он меняет обработку команды остановки.',
      );
    if (/^(exit|stop)\b/i.test(command))
      throw new Error('Для остановки используйте кнопку «Остановить»');
    r.worker.send({ type: 'command', command });
  }
  private journal() {
    const write = () =>
      atomicWrite(
        path.join(this.data, 'process-journal.json'),
        JSON.stringify(
          [...this.running].filter(([, r]) => r.pid).map(([id, r]) => ({ id, pid: r.pid })),
        ),
      );
    this.journalQueue = this.journalQueue.then(write, write);
    return this.journalQueue;
  }
  async openFolder(id: string) {
    const s = this.get(id);
    await rejectLinks(s.root);
    const error = await shell.openPath(s.root);
    if (error) throw new Error('Не удалось открыть папку');
  }
  async chooseJava(id?: string) {
    if (id) this.get(id);
    const r = await dialog.showOpenDialog(this.window(), {
      title: 'Выберите java.exe (не javaw.exe)',
      filters: [{ name: 'Java executable', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    if (r.canceled) return false;
    if (path.basename(r.filePaths[0]).toLowerCase() !== 'java.exe')
      throw new Error('Нужен java.exe');
    await this.store.setting(id ? `java:${id}` : 'java', r.filePaths[0]);
    return true;
  }
  async importBinary(id: string) {
    const s = this.get(id);
    this.stopped(s);
    const ext = s.game === 'beammp' ? 'exe' : 'jar';
    const picked = await dialog.showOpenDialog(this.window(), {
      title: 'Импорт серверного файла из доверенного источника',
      filters: [{ name: binaryName(s), extensions: [ext] }],
      properties: ['openFile'],
    });
    if (picked.canceled) return;
    const source = picked.filePaths[0];
    const confirm = await dialog.showMessageBox(this.window(), {
      type: 'warning',
      buttons: ['Отмена', 'Импортировать'],
      defaultId: 0,
      cancelId: 0,
      message: 'Серверный файл выполняет код с вашими правами Windows.',
      detail:
        'Продолжайте только для файла, полученного с официального сайта. Импорт не означает проверку подлинности.',
    });
    if (confirm.response !== 1) return;
    if (ext === 'jar') await inspectZip(source);
    await this.backup(id);
    const dest = inside(s.root, binaryName(s));
    await rejectLinks(s.root, dest);
    await fs.copyFile(source, dest);
    await this.refreshInstalled(s);
  }
  async install(id: string) {
    const s = this.get(id);
    this.stopped(s);
    if (extraGames.has(s.game)) {
      await this.backup(id);
      const control = new AbortController();
      this.installs.set(id, control);
      try {
        const existing =
          s.game === 'valheim' && process.platform === 'win32'
            ? await detectTool('valheim')
            : undefined;
        if (existing) {
          s.installation = { phase: 'Копирование официального Valheim Server' };
          await copyTool(existing, s.root);
        } else
          await installExtra(s, this.data, control.signal, (phase) => {
            s.installation = { phase };
          });
        await configure(s, '', await this.passwords(s));
        if (s.game === 'factorio') {
          await fs.mkdir(inside(s.root, 'worlds'), { recursive: true });
          const world = inside(s.root, `worlds/${s.world}.zip`);
          if (
            !(await fs
              .access(world)
              .then(() => true)
              .catch(() => false))
          )
            await runTool(
              inside(s.root, binaryName(s)),
              ['--create', world, '--map-gen-settings', 'map-gen-settings.json'],
              s,
              control.signal,
            );
        }
        await this.refreshInstalled(s);
        await this.store.put(s);
        return s;
      } catch (error) {
        s.installation = { phase: 'Ошибка установки', error: redact((error as Error).message) };
        throw error;
      } finally {
        this.installs.delete(id);
      }
    }
    if (s.game === 'minecraft') {
      if (!s.eula)
        throw new Error(
          'Перед загрузкой Minecraft прочитайте EULA и отметьте согласие в настройках.',
        );
      await this.backup(id);
      const control = new AbortController();
      this.installs.set(id, control);
      const progress = (phase: string, bytes?: number, total?: number) => {
        s.installation = { phase, bytes, total };
      };
      try {
        const java = await installMinecraft(s, this.data, control.signal, progress);
        await this.store.setting(`java:${s.id}`, java);
        await configure(s, '');
        await this.refreshInstalled(s);
        await this.store.put(s);
      } catch (error) {
        s.installation = { phase: 'Ошибка установки', error: redact((error as Error).message) };
        throw error;
      } finally {
        this.installs.delete(id);
      }
      return s;
    }
    if (racingGames.has(s.game)) {
      const source = await detectTool(s.game);
      if (!source) {
        s.installation = { phase: 'Ожидание установки в Steam' };
        await requestSteamInstall(s.game);
        return;
      }
      await this.backup(id);
      s.installation = { phase: 'Копирование официального сервера из Steam' };
      await copyTool(source, s.root, (name) => {
        s.installation = { phase: 'Копирование: ' + name };
      });
      if (s.game === 'assetto') {
        const sourceConfig = await fs
          .readFile(path.join(source, 'cfg', 'server_cfg.ini'), 'utf8')
          .catch(() => '');
        const file = inside(s.root, 'cfg/server_cfg.ini');
        const current = await fs.readFile(file, 'utf8').catch(() => '');
        if (sourceConfig) await atomicWrite(file, patchIni(sourceConfig, parseIni(current)));
      }
      await configure(s, '', await this.passwords(s));
      await this.refreshInstalled(s);
      s.installation = { phase: 'Официальный сервер установлен' };
      await this.store.put(s);
      return s;
    }
    await this.backup(id);
    const control = new AbortController();
    this.installs.set(id, control);
    try {
      s.installation = { phase: 'Поиск официального релиза BeamMP' };
      const release = await officialJson<{
        tag_name: string;
        assets: { name: string; size: number; browser_download_url: string; digest?: string }[];
      }>('https://api.github.com/repos/BeamMP/BeamMP-Server/releases/latest', control.signal);
      let assetName = 'BeamMP-Server.exe';
      if (process.platform !== 'win32') {
        const osRelease = await fs.readFile('/etc/os-release', 'utf8');
        const distro = /^ID="?(\w+)/m.exec(osRelease)?.[1],
          version = /^VERSION_ID="?([\d.]+)/m.exec(osRelease)?.[1];
        const prefix = `BeamMP-Server.${distro}.`,
          suffix = '.x86_64';
        // Vendor builds for an older supported release can run on newer glibc. Never cross distributions.
        const candidates = release.assets.filter(
          (a) =>
            a.name.startsWith(prefix) &&
            a.name.endsWith(suffix) &&
            Number(a.name.slice(prefix.length, -suffix.length)) <= Number(version),
        );
        candidates.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
        assetName = candidates[0]?.name ?? '';
      }
      const asset = release.assets.find((a) => a.name === assetName);
      if (!asset) throw new Error('BeamMP не публикует подходящую сборку для этой ОС');
      const url = new URL(asset.browser_download_url);
      if (
        url.origin !== 'https://github.com' ||
        !url.pathname.startsWith('/BeamMP/BeamMP-Server/releases/download/')
      )
        throw new Error('Недоверенный адрес релиза');
      if (asset.size > 250 * 1024 ** 2) throw new Error('Неожиданно большой файл');
      const target = inside(s.root, binaryName(s));
      await rejectLinks(s.root, target);
      await download(asset.browser_download_url, target, {
        signal: control.signal,
        size: asset.size,
        hash: asset.digest?.replace(/^sha256:/, ''),
        progress: (bytes, total) => {
          s.installation = { phase: 'Скачивание BeamMP', bytes, total };
        },
      });
      if (process.platform !== 'win32') await fs.chmod(target, 0o700);
      await configure(s, await this.secret(s));
      await this.refreshInstalled(s);
      s.installation = { phase: 'BeamMP установлен' };
      this.log(id, `Установлен BeamMP ${release.tag_name}`);
    } catch (error) {
      s.installation = { phase: 'Ошибка установки', error: redact((error as Error).message) };
      throw error;
    } finally {
      this.installs.delete(id);
    }
  }
  async content(id: string) {
    return listContent(this.get(id));
  }
  async importContent(id: string, kind: ContentKind = 'auto') {
    const s = this.get(id);
    this.stopped(s);
    const pick = await dialog.showOpenDialog(this.window(), {
      title: 'Добавить контент ' + s.game,
      filters: [{ name: 'Контент', extensions: ['zip', 'jar', 'lua'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (!pick.canceled)
      return importFiles(s, pick.filePaths, kind, this.window(), () => this.backup(id));
  }
  async dropped(id: string, paths: string[], kind: ContentKind) {
    const s = this.get(id);
    this.stopped(s);
    return importFiles(s, paths, kind, this.window(), () => this.backup(id));
  }
  async toggleContent(id: string, name: string) {
    const s = this.get(id);
    this.stopped(s);
    return toggleFile(s, name, () => this.backup(id));
  }
  private async contentEntry(id: string, name: string) {
    const s = this.get(id),
      item = (await listContent(s)).find((f) => f.name === name);
    if (!item) throw new Error('Контент не найден');
    return { s, item, source: await actualContentPath(s, name, item.enabled) };
  }
  async contentDetails(id: string, name: string) {
    const { s, source } = await this.contentEntry(id, name);
    return contentDetails(s, name, source);
  }
  async saveContentConfig(id: string, name: string, file: string, text: string) {
    const { s, source } = await this.contentEntry(id, name);
    this.stopped(s);
    await this.backup(id);
    await saveContentConfig(s, name, source, file, text);
    return this.contentDetails(id, name);
  }
  async setContentEnabled(id: string, names: string[], enabled: boolean) {
    const s = this.get(id);
    this.stopped(s);
    for (const name of names) {
      const item = (await listContent(s)).find((f) => f.name === name);
      if (!item) throw new Error('Контент не найден');
      if (item.enabled !== enabled) await this.toggleContent(id, name);
    }
    return listContent(s);
  }
  async removeContent(id: string, name: string) {
    const { s, source } = await this.contentEntry(id, name);
    this.stopped(s);
    await this.backup(id);
    await rejectLinks(s.root, source);
    const quarantine = inside(s.root, 'quarantine/' + crypto.randomUUID());
    await fs.mkdir(path.dirname(quarantine), { recursive: true });
    await fs.rename(source, quarantine);
    this.log(id, 'Контент перемещён в карантин: ' + name);
    return listContent(s);
  }
  async importWorld(id: string) {
    return this.importContent(id, 'world');
  }
  private backupDir(id: string) {
    return path.join(this.data, 'backups', id);
  }
  async backups(id: string): Promise<Backup[]> {
    this.get(id);
    const dir = this.backupDir(id);
    const files = await fs.readdir(dir).catch(() => []);
    const list: Backup[] = [];
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      const b = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      list.push(b);
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async backup(id: string) {
    const s = this.get(id);
    this.stopped(s);
    const dir = this.backupDir(id);
    await fs.mkdir(dir, { recursive: true });
    const bid = crypto.randomUUID(),
      target = path.join(dir, bid + '.zip');
    await zipFolder(s.root, target);
    const record: Backup = {
      id: bid,
      createdAt: new Date().toISOString(),
      bytes: (await fs.stat(target)).size,
      sha256: await hashFile(target),
    };
    await atomicWrite(path.join(dir, bid + '.json'), JSON.stringify(record));
    this.log(id, 'Создана резервная копия остановленного сервера');
    return record;
  }
  async restore(id: string, backupId: string) {
    const s = this.get(id);
    this.stopped(s);
    const b = (await this.backups(id)).find((b) => b.id === backupId);
    if (!b) throw new Error('Копия не найдена');
    const source = path.join(this.backupDir(id), b.id + '.zip');
    if ((await hashFile(source)) !== b.sha256)
      throw new Error('Нарушена целостность резервной копии');
    const confirm = await dialog.showMessageBox(this.window(), {
      type: 'warning',
      message: 'Восстановить копию?',
      detail:
        'Текущая папка останется рядом с суффиксом .before-restore. Серверное ядро нужно импортировать заново; исполняемые файлы не входят в копии.',
      buttons: ['Отмена', 'Восстановить'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirm.response !== 1) return;
    const stage = s.root + '.restore-' + crypto.randomUUID();
    await rejectLinks(s.root);
    try {
      await extractZip(source, stage);
      await fs.rename(s.root, s.root + '.before-restore-' + Date.now());
      await fs.rename(stage, s.root);
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
    Object.assign(s, await readConfig(s));
    const parsed = serverInput.safeParse(
      Object.fromEntries(
        Object.keys(serverInput.shape)
          .filter((k) => k !== 'authKey')
          .map((k) => [k, (s as any)[k]]),
      ),
    );
    if (!parsed.success)
      throw new Error('Копия восстановлена; параметры требуют проверки перед запуском');
    if (s.game === 'assetto') {
      const file = inside(s.root, 'cfg/server_cfg.ini');
      await atomicWrite(
        file,
        patchIni(await fs.readFile(file, 'utf8'), {
          SERVER: {
            PASSWORD: (await this.passwords(s)).password ?? '',
            ADMIN_PASSWORD: (await this.passwords(s)).adminPassword ?? '',
          },
        }),
      );
    } else if (s.game === 'acc') {
      const file = inside(s.root, 'cfg/settings.json');
      await writeJson(
        file,
        {
          ...(await readJson(file)),
          password: (await this.passwords(s)).password ?? '',
          adminPassword: (await this.passwords(s)).adminPassword ?? '',
        },
        true,
      );
    } else if (s.game === 'evo') {
      const file = inside(s.root, 'server_config.json');
      await writeJson(file, {
        ...(await readJson(file)),
        driver_password: (await this.passwords(s)).password ?? '',
        admin_password: (await this.passwords(s)).adminPassword ?? '',
      });
    } else await configure(s, await this.secret(s), await this.passwords(s));
    await this.store.put(s);
    await this.refreshInstalled(s);
  }
}
