import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Action, HubAPI, Reply } from '../shared/contracts';
const actions: Action[] = [
  'nightcoopInfo',
  'nightcoopFile',
  'freePort',
  'gameOptions',
  'versions',
  'configDocuments',
  'saveConfigDocument',
  'cancelInstall',
  'snapshot',
  'create',
  'update',
  'start',
  'stop',
  'logs',
  'command',
  'install',
  'importBinary',
  'chooseJava',
  'diagnose',
  'openFolder',
  'content',
  'importContent',
  'toggleContent',
  'contentDetails',
  'removeContent',
  'setContentEnabled',
  'saveContentConfig',
  'importWorld',
  'backups',
  'backup',
  'restore',
  'guide',
  'setRoot',
  'quit',
];
const api: HubAPI = {
  async dropFiles(id, files, kind = 'auto') {
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    const reply: Reply<unknown> = await ipcRenderer.invoke('gamehub:drop', { id, paths, kind });
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  },
  async call<T>(action: Action, payload?: unknown): Promise<T> {
    if (!actions.includes(action)) throw new Error('Неизвестная операция');
    const reply: Reply<T> = await ipcRenderer.invoke('gamehub:action', action, payload);
    if (!reply.ok) throw new Error(reply.error);
    return reply.data;
  },
};
contextBridge.exposeInMainWorld('gamehub', api);
