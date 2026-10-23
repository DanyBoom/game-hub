import { z } from 'zod';
import { idSchema, serverInput, gameId } from '../shared/contracts';
import type { Manager } from '../electron/manager';
import { games } from '../shared/catalog';
const named = z.object({ id: idSchema, name: z.string().min(1).max(200) }).strict();
export async function dispatch(manager: Manager, action: string, payload: unknown) {
  const id = () => idSchema.parse(payload);
  switch (action) {
    case 'nightcoopInfo':
      return manager.nightcoopInfo(id());
    case 'nightcoopFile': {
      const v = z
        .object({
          id: idSchema,
          name: z.enum(['hub.cert', 'hub-list.bin', 'locations.txt']),
          base64: z
            .string()
            .max(1400000)
            .regex(/^[A-Za-z0-9+/=]+$/),
        })
        .strict()
        .parse(payload);
      return manager.nightcoopFile(v.id, v.name, v.base64);
    }
    case 'freePort':
      return manager.freePort();
    case 'snapshot':
      return manager.snapshot();
    case 'create': {
      const input = serverInput.parse(payload);
      const g = (await manager.snapshot()).games.find((g) => g.id === input.game);
      if (g?.support !== 'early') throw new Error('Игра не поддерживается этой ОС');
      return manager.create(input);
    }
    case 'update': {
      const v = z.object({ id: idSchema, input: serverInput }).strict().parse(payload);
      return manager.update(v.id, v.input);
    }
    case 'start':
      return manager.start(id());
    case 'stop':
      return manager.stop(id());
    case 'logs':
      return manager.getLogs(id());
    case 'diagnose':
      return manager.diagnose(id());
    case 'install':
      return manager.install(id());
    case 'cancelInstall':
      return manager.cancelInstall(id());
    case 'versions':
      return manager.versions(
        z.enum(['vanilla', 'paper', 'fabric', 'forge', 'neoforge']).parse(payload),
      );
    case 'gameOptions':
      return manager.options(z.union([idSchema, gameId]).parse(payload));
    case 'content':
      return manager.content(id());
    case 'contentDetails':
    case 'removeContent': {
      const v = named.parse(payload);
      return action === 'contentDetails'
        ? manager.contentDetails(v.id, v.name)
        : manager.removeContent(v.id, v.name);
    }
    case 'toggleContent': {
      const v = named.parse(payload);
      return manager.toggleContent(v.id, v.name);
    }
    case 'setContentEnabled': {
      const v = z
        .object({
          id: idSchema,
          names: z.array(z.string().min(1).max(200)).min(1).max(200),
          enabled: z.boolean(),
        })
        .strict()
        .parse(payload);
      return manager.setContentEnabled(v.id, v.names, v.enabled);
    }
    case 'saveContentConfig': {
      const v = z
        .object({
          id: idSchema,
          name: z.string().max(200),
          file: z.string().max(300),
          text: z.string().max(256 * 1024),
        })
        .strict()
        .parse(payload);
      return manager.saveContentConfig(v.id, v.name, v.file, v.text);
    }
    case 'configDocuments':
      return manager.documents(id());
    case 'saveConfigDocument': {
      const v = z
        .object({ id: idSchema, name: z.string().max(200), data: z.record(z.unknown()) })
        .strict()
        .parse(payload);
      return manager.saveDocument(v.id, v.name, v.data);
    }
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
      return manager.command(v.id, v.command);
    }
    case 'backups':
      return manager.backups(id());
    case 'backup':
      return manager.backup(id());
    case 'restore': {
      const v = z.object({ id: idSchema, backupId: idSchema }).strict().parse(payload);
      return manager.restore(v.id, v.backupId);
    }
    case 'openFolder':
      return manager.get(id()).root;
    case 'guide':
      return games.find((g) => g.id === gameId.parse(payload))?.docs;
    default:
      throw new Error('Операция недоступна в серверной панели');
  }
}
