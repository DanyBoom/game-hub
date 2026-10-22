import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store } from './store';
import { Manager } from './manager';
import { idSchema, serverInput, gameId } from '../shared/contracts';
import { games } from '../shared/catalog';
import { redact } from './security';
app.setName('GameHub');
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let win: BrowserWindow;
let manager: Manager;
let tray: Tray;
let quitting = false;
let closePrompt = false;
const development = !app.isPackaged && process.env.GAMEHUB_DEV === '1';
const devUrl = 'http://127.0.0.1:5173';
const productionUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
let queue: Promise<unknown> = Promise.resolve();
async function quitSafely() {
  if (closePrompt) return;
  closePrompt = true;
  try {
    if (manager.running.size) {
      const choice = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Отмена', 'Свернуть в трей', 'Остановить серверы и выйти'],
        defaultId: 0,
        cancelId: 0,
        message: 'Есть работающие игровые серверы',
        detail:
          'В трее GameHub продолжит управлять процессами. При выходе дождёмся их штатного сохранения.',
      });
      if (choice.response === 0) return;
      if (choice.response === 1) {
        win.hide();
        return;
      }
      for (const id of [...manager.running.keys()]) await manager.stop(id);
    }
    quitting = true;
    setImmediate(() => app.quit());
  } catch (error) {
    await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Выход отложен',
      detail: redact((error as Error).message),
    });
  } finally {
    closePrompt = false;
  }
}
if (gotLock)
  app
    .whenReady()
    .then(async () => {
      if (process.platform !== 'win32') {
        await dialog.showMessageBox({
          type: 'error',
          message: 'GameHub поддерживает только Windows 11',
        });
        app.quit();
        return;
      }
      const data = app.getPath('userData');
      await fs.mkdir(data, { recursive: true });
      const store = new Store(path.join(data, 'gamehub.sqlite'));
      const wasm = app.isPackaged
        ? path.join(process.resourcesPath, 'sql-wasm.wasm')
        : path.join(app.getAppPath(), 'node_modules/sql.js/dist/sql-wasm.wasm');
      await store.init(wasm);
      win = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 1040,
        minHeight: 720,
        backgroundColor: '#101116',
        title: 'GameHub',
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          devTools: !app.isPackaged,
        },
      });
      manager = new Manager(store, data, () => win);
      await manager.init();
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (e, url) => {
        if (url !== (development ? devUrl + '/' : productionUrl)) e.preventDefault();
      });
      win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      win.webContents.session.setPermissionCheckHandler(() => false);
      win.webContents.on('will-attach-webview', (e) => e.preventDefault());
      ipcMain.handle('gamehub:action', async (event, action: unknown, payload: unknown) => {
        const sender = event.senderFrame;
        if (
          !sender ||
          sender !== win.webContents.mainFrame ||
          sender.url !== (development ? devUrl + '/' : productionUrl)
        )
          return { ok: false, error: 'Недоверенный источник IPC' };
        const execute = async () => {
          try {
            const id = () => idSchema.parse(payload);
            let result: unknown;
            switch (action) {
              case 'snapshot':
                result = await manager.snapshot();
                break;
              case 'create':
                result = await manager.create(serverInput.parse(payload));
                break;
              case 'update': {
                const v = z.object({ id: idSchema, input: serverInput }).strict().parse(payload);
                result = await manager.update(v.id, v.input);
                break;
              }
              case 'start':
                result = await manager.start(id());
                break;
              case 'stop':
                result = await manager.stop(id());
                break;
              case 'logs':
                result = manager.getLogs(id());
                break;
              case 'command': {
                const v = z
                  .object({
                    id: idSchema,
                    command: z
                      .string()
                      .trim()
                      .min(1)
                      .max(400)
                      .regex(/^[^\r\n\x00]+$/),
                  })
                  .strict()
                  .parse(payload);
                result = manager.command(v.id, v.command);
                break;
              }
              case 'diagnose':
                result = await manager.diagnose(id());
                break;
              case 'install':
                result = await manager.install(id());
                break;
              case 'importBinary':
                result = await manager.importBinary(id());
                break;
              case 'chooseJava':
                result = await manager.chooseJava();
                break;
              case 'setRoot':
                result = await manager.setRoot();
                break;
              case 'openFolder':
                result = await manager.openFolder(id());
                break;
              case 'content':
                result = await manager.content(id());
                break;
              case 'importContent':
                result = await manager.importContent(id());
                break;
              case 'toggleContent': {
                const v = z
                  .object({
                    id: idSchema,
                    name: z
                      .string()
                      .min(1)
                      .max(200)
                      .regex(/^[^\\/:\x00]+$/),
                  })
                  .strict()
                  .parse(payload);
                result = await manager.toggleContent(v.id, v.name);
                break;
              }
              case 'importWorld':
                result = await manager.importWorld(id());
                break;
              case 'backups':
                result = await manager.backups(id());
                break;
              case 'backup':
                result = await manager.backup(id());
                break;
              case 'restore': {
                const v = z.object({ id: idSchema, backupId: idSchema }).strict().parse(payload);
                result = await manager.restore(v.id, v.backupId);
                break;
              }
              case 'guide': {
                const game = gameId.parse(payload);
                await shell.openExternal(games.find((g) => g.id === game)!.docs);
                break;
              }
              case 'quit':
                await quitSafely();
                break;
              default:
                throw new Error('Неизвестная операция');
            }
            return { ok: true, data: result };
          } catch (error) {
            return {
              ok: false,
              error:
                error instanceof z.ZodError
                  ? 'Проверьте поля формы: ' +
                    error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')
                  : redact((error as Error).message),
            };
          }
        };
        // Reads do not wait behind a download or graceful stop. Mutations are serialized.
        if (['snapshot', 'logs', 'content', 'backups'].includes(String(action))) return execute();
        const next = queue.then(execute, execute);
        queue = next;
        return next;
      });
      await win.loadURL(development ? devUrl : productionUrl);
      win.once('ready-to-show', () => win.show());
      win.show();
      win.on('close', (e) => {
        if (!quitting) {
          e.preventDefault();
          void quitSafely();
        }
      });
      const icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABS0lEQVQ4T6WTvUoDQRRGz91kVhRBrK1tRBsLCzsrHxF9CvsI9hY+gI1gYWFj5wOIiYWFhU0qRZQg/oCfxImsS5x1kgU3zJ1z5nzn3M/FLPjYcQNYYBHADPAG6AGoJLQPDDgAjAFn+AEusCCkQMsV4ABYAn59lzXoJZV6ccTXViIQTYB5wmCOrF6a9xARgB3jNtvxlRhEqQHYk/F1AUd9wBJu4AWVVYfCBiwC9UBxu6IcV0TvUBKuM0vL4nKoHi1Jbd9hVSlwAzaEtwBmSmIYcrxfBCF8jLy2QHiGpd5/QRuAE9pC7vWDH4RDP6BHuAlwLdCxjDpawMOFkB+1h5QoNKtawCTAR6Ywc/S9qtwCi1CM7LPRaUVjgDXGBF9A8vQNnCekOFrTGhvH5IOPq16sjIvfQk0GNpZwF3CKsDBJfy/Z6iRqdoAc65wY6GT52BFjJ44BuY8OfsR2m/OF4Ppgls0AAAAASUVORK5CYII=',
      );
      tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
      tray.setToolTip('GameHub — локальные серверы');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: 'Открыть GameHub',
            click: () => {
              win.show();
              win.focus();
            },
          },
          { label: 'Выход', click: () => void quitSafely() },
        ]),
      );
      tray.on('double-click', () => win.show());
      app.on('second-instance', () => {
        win.show();
        win.focus();
      });
    })
    .catch(async () => {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Не удалось открыть GameHub',
        detail:
          'Проверьте доступ к локальным данным приложения. Приватные подробности не отправлены.',
      });
      app.quit();
    });
app.on('before-quit', (event) => {
  if (!quitting && manager?.running.size) {
    event.preventDefault();
    void quitSafely();
  }
});
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
