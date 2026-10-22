import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import pidusage from 'pidusage';
import { app, dialog, safeStorage, shell, type BrowserWindow } from 'electron';
import { Store } from './store';
import { binaryName, configure, readConfig } from './adapters';
import { atomicWrite, inside, redact, rejectLinks } from './security';
import { extractZip, hashFile, inspectZip, zipFolder } from './archives';
import { games } from '../shared/catalog';
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
  readonly servers = new Map<string, ServerRecord>();
  readonly running = new Map<string, Running>();
  private logs = new Map<string, LogLine[]>();
  private cpu = 0;
  private cpuSample = os.cpus().map((c) => c.times);
  private timer?: NodeJS.Timeout;
  private journalQueue: Promise<void> = Promise.resolve();
  constructor(
    readonly store: Store,
    private data: string,
    private window: () => BrowserWindow,
  ) {}
  async init() {
    for (const s of this.store.all()) {
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
      }
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
      games,
      version: app.getVersion(),
    };
  }
  get(id: string) {
    const s = this.servers.get(id);
    if (!s) throw new Error('Сервер не найден');
    return s;
  }
  private stopped(s: ServerRecord) {
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
    const { authKey, ...values } = serverInput.parse(input);
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
    await configure(s, authKey ?? '');
    await this.store.put(s);
    this.servers.set(id, s);
    return s;
  }
  async update(id: string, input: ServerInput) {
    const s = this.get(id);
    this.stopped(s);
    const { authKey, ...values } = serverInput.parse(input);
    if (values.game !== s.game) throw new Error('Нельзя менять игру существующего сервера');
    if ([...this.servers.values()].some((v) => v.id !== id && v.port === values.port))
      throw new Error('Конфликт порта с другим сервером');
    await this.backup(id);
    if (authKey) await this.saveSecret(s, authKey);
    const next = { ...s, ...values };
    await configure(next, await this.secret(s));
    await this.store.put(next);
    this.servers.set(id, next);
    return next;
  }
  private async saveSecret(s: ServerRecord, value: string) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Windows DPAPI недоступен: ключ не будет сохранён');
    await this.store.setting(`secret:${s.id}`, safeStorage.encryptString(value).toString('base64'));
    s.hasSecret = true;
  }
  private async secret(s: ServerRecord) {
    const value = this.store.getSetting(`secret:${s.id}`);
    return value ? safeStorage.decryptString(Buffer.from(value, 'base64')) : '';
  }
  private async refreshInstalled(s: ServerRecord) {
    s.installed = await fs
      .access(path.join(s.root, binaryName(s)))
      .then(() => true)
      .catch(() => false);
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
    if (s.game === 'beammp') {
      const udp = await new Promise<boolean>((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.unref();
        socket.once('error', () => {
          socket.close();
          resolve(false);
        });
        socket.bind(s.port, '0.0.0.0', () => socket.close(() => resolve(true)));
      });
      checks.push({
        label: `UDP ${s.port}`,
        ok: udp,
        detail: udp ? 'Свободен на момент проверки' : 'Занят или недоступен',
      });
    }
    return checks;
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
          ? 'Ключ сохранён через Windows DPAPI'
          : 'Получите ключ на keymaster.beammp.com',
      });
    if (s.game === 'minecraft') {
      checks.push({
        label: 'Лицензионное соглашение',
        ok: s.eula,
        detail: 'Принимается только явной отметкой пользователя',
      });
      const java = this.store.getSetting('java');
      checks.push({
        label: 'Java',
        ok:
          !!java &&
          (await fs
            .access(java)
            .then(() => true)
            .catch(() => false)),
        detail: 'Выберите java.exe нужной версии. GameHub не устанавливает Java автоматически.',
      });
      checks.push({
        label: 'Оперативная память',
        ok: s.memory < os.freemem() / 1024 ** 2,
        detail: `Выделено ${s.memory} МБ; доступно ${Math.round(os.freemem() / 1024 ** 2)} МБ`,
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
    await configure(s, secret);
    const binary = inside(s.root, binaryName(s));
    await rejectLinks(s.root, binary);
    const executable = s.game === 'beammp' ? binary : this.store.getSetting('java')!;
    const args =
      s.game === 'beammp' ? [] : [`-Xms512M`, `-Xmx${s.memory}M`, '-jar', binary, 'nogui'];
    const worker = fork(path.join(__dirname, 'runner.cjs'), [], {
      execPath: process.execPath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        GAMEHUB_STOP: s.game === 'minecraft' ? 'stop' : 'exit',
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
          this.log(id, message.text ?? '', message.stream, [secret]);
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
  }
  command(id: string, command: string) {
    const s = this.get(id),
      r = this.running.get(id);
    if (!r || r.stopping) throw new Error('Сервер не запущен');
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
  async chooseJava() {
    const r = await dialog.showOpenDialog(this.window(), {
      title: 'Выберите java.exe (не javaw.exe)',
      filters: [{ name: 'Java executable', extensions: ['exe'] }],
      properties: ['openFile'],
    });
    if (r.canceled) return false;
    if (path.basename(r.filePaths[0]).toLowerCase() !== 'java.exe')
      throw new Error('Нужен java.exe');
    await this.store.setting('java', r.filePaths[0]);
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
    if (s.game !== 'beammp') return this.importBinary(id);
    const response = await fetch(
      'https://api.github.com/repos/BeamMP/BeamMP-Server/releases/latest',
      { headers: { 'User-Agent': 'GameHub/0.1' }, signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) throw new Error('GitHub не вернул официальный релиз');
    const release = (await response.json()) as {
      tag_name: string;
      assets: { name: string; size: number; browser_download_url: string; digest?: string }[];
    };
    const asset = release.assets.find((a) => a.name.toLowerCase() === 'beammp-server.exe');
    if (!asset)
      throw new Error(
        'В релизе нет ожидаемого Windows EXE. Импортируйте официальный файл вручную.',
      );
    const url = new URL(asset.browser_download_url);
    if (
      url.origin !== 'https://github.com' ||
      !url.pathname.startsWith('/BeamMP/BeamMP-Server/releases/download/')
    )
      throw new Error('Недоверенный адрес релиза');
    if (asset.size > 250 * 1024 ** 2) throw new Error('Неожиданно большой файл');
    const confirm = await dialog.showMessageBox(this.window(), {
      type: 'question',
      buttons: ['Отмена', 'Скачать'],
      defaultId: 0,
      cancelId: 0,
      message: `Скачать BeamMP ${release.tag_name}?`,
      detail: `Официальный репозиторий BeamMP/BeamMP-Server, ${Math.ceil(asset.size / 1024 ** 2)} МБ. Исполняемый файл будет запущен только по кнопке «Запустить». ${asset.digest ? 'SHA-256 будет проверен.' : 'Релиз не содержит digest; криптографическая подлинность не подтверждена.'}`,
    });
    if (confirm.response !== 1) return;
    await this.backup(id);
    const result = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120000) });
    if (!result.ok || !result.body) throw new Error('Не удалось скачать EXE');
    const dest = inside(s.root, binaryName(s));
    await rejectLinks(s.root, dest);
    const tmp = dest + '.download';
    const file = await fs.open(tmp, 'wx');
    let bytes = 0;
    const hash = crypto.createHash('sha256');
    try {
      for await (const chunk of result.body as any) {
        bytes += chunk.length;
        if (bytes > 250 * 1024 ** 2 || bytes > asset.size)
          throw new Error('Размер загрузки превышен');
        hash.update(chunk);
        await file.write(chunk);
      }
      await file.close();
      if (bytes !== asset.size) throw new Error('Файл загружен не полностью');
      const digest = hash.digest('hex');
      if (asset.digest && asset.digest !== `sha256:${digest}`)
        throw new Error('SHA-256 не совпадает');
      await fs.rename(tmp, dest);
    } catch (error) {
      await file.close().catch(() => {});
      await fs.rm(tmp, { force: true });
      throw error;
    }
    this.log(id, `Установлен BeamMP ${release.tag_name}`);
    await this.refreshInstalled(s);
  }
  async content(id: string) {
    const s = this.get(id),
      folder = inside(s.root, s.game === 'beammp' ? 'Resources/Client' : 'plugins');
    await rejectLinks(s.root, folder);
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    return Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => ({
          name: e.name,
          bytes: (await fs.stat(inside(folder, e.name))).size,
          enabled: !e.name.endsWith('.disabled'),
        })),
    );
  }
  async importContent(id: string) {
    const s = this.get(id);
    this.stopped(s);
    if (s.game === 'minecraft' && s.core !== 'paper')
      throw new Error(
        'Vanilla не поддерживает JAR-плагины. Выберите Paper и установите соответствующее ядро.',
      );
    const ext = s.game === 'beammp' ? 'zip' : 'jar';
    const picked = await dialog.showOpenDialog(this.window(), {
      title:
        s.game === 'beammp'
          ? 'Карта или автомобиль BeamMP ZIP'
          : 'Плагин Paper JAR (выполняемый код)',
      filters: [{ name: 'Контент', extensions: [ext] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (picked.canceled) return;
    const dir = inside(s.root, s.game === 'beammp' ? 'Resources/Client' : 'plugins');
    await rejectLinks(s.root, dir);
    const files = [];
    for (const source of picked.filePaths) {
      const name = path.basename(source);
      if (path.extname(name).toLowerCase() !== '.' + ext)
        throw new Error('Неподдерживаемый формат');
      const entries = await inspectZip(source);
      if (s.game === 'beammp' && !entries.some((e) => /^(levels|vehicles)\//i.test(e.name)))
        throw new Error(`${name}: нет папок levels/ или vehicles/`);
      if (
        s.game === 'minecraft' &&
        !entries.some((e) => /^(paper-plugin|plugin)\.yml$/.test(e.name))
      )
        throw new Error(`${name}: отсутствует plugin.yml`);
      files.push({ source, name, entries });
    }
    const preview = await dialog.showMessageBox(this.window(), {
      type: 'warning',
      message: `Установить файлов: ${files.length}?`,
      detail:
        files
          .map(
            (f) =>
              `${f.name}: ${f.entries.length} элементов\n${f.entries
                .slice(0, 5)
                .map((e) => e.name)
                .join('\n')}`,
          )
          .join('\n\n') +
        '\nСовместимость с версией игры автоматически не подтверждена. Плагины выполняют код.',
      buttons: ['Отмена', 'Установить'],
      defaultId: 0,
      cancelId: 0,
    });
    if (preview.response !== 1) return;
    await this.backup(id);
    await fs.mkdir(dir, { recursive: true });
    for (const file of files) {
      const target = inside(dir, file.name);
      await rejectLinks(s.root, target);
      if (
        await fs
          .access(target)
          .then(() => true)
          .catch(() => false)
      )
        throw new Error('Файл уже существует: ' + file.name);
      await fs.copyFile(file.source, target, 2);
    }
    return this.content(id);
  }
  async toggleContent(id: string, name: string) {
    const s = this.get(id);
    this.stopped(s);
    const folder = inside(s.root, s.game === 'beammp' ? 'Resources/Client' : 'plugins');
    const source = inside(folder, name),
      target = inside(folder, name.endsWith('.disabled') ? name.slice(0, -9) : name + '.disabled');
    await rejectLinks(s.root, source);
    await rejectLinks(s.root, target);
    if (
      await fs
        .access(target)
        .then(() => true)
        .catch(() => false)
    )
      throw new Error('Целевой файл уже существует');
    await this.backup(id);
    await fs.rename(source, target);
    return this.content(id);
  }
  async importWorld(id: string) {
    const s = this.get(id);
    this.stopped(s);
    if (s.game !== 'minecraft') throw new Error('Импорт миров доступен для Minecraft');
    const picked = await dialog.showOpenDialog(this.window(), {
      title: 'ZIP мира: level.dat должен находиться в корне',
      filters: [{ name: 'World ZIP', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (picked.canceled) return;
    const entries = await inspectZip(picked.filePaths[0]);
    if (!entries.some((e) => e.name === 'level.dat'))
      throw new Error('В корне ZIP отсутствует level.dat');
    const target = inside(s.root, s.world);
    await rejectLinks(s.root, target);
    const confirmation = await dialog.showMessageBox(this.window(), {
      type: 'warning',
      message: 'Заменить мир импортированным?',
      detail:
        'Существующий мир будет переименован после создания резервной копии. Импортируемые datapacks могут менять поведение игры.',
      buttons: ['Отмена', 'Импортировать'],
      cancelId: 0,
      defaultId: 0,
    });
    if (confirmation.response !== 1) return;
    await this.backup(id);
    const stage = inside(s.root, 'import-' + crypto.randomUUID());
    try {
      await extractZip(picked.filePaths[0], stage);
      if (
        await fs
          .access(target)
          .then(() => true)
          .catch(() => false)
      )
        await fs.rename(target, target + '.previous-' + Date.now());
      await fs.rename(stage, target);
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
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
    await configure(s, await this.secret(s));
    await this.store.put(s);
    await this.refreshInstalled(s);
  }
}
