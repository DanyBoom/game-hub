import { z } from 'zod';
export const gameId = z.enum(['beammp', 'minecraft', 'assetto', 'valheim', 'evo', 'acc', 'lmu']);
export type GameId = z.infer<typeof gameId>;
export const idSchema = z.string().uuid();
const line = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((s) => !/[\r\n\x00]/.test(s), 'Недопустимые символы');
export const serverInput = z
  .object({
    game: z.enum(['beammp', 'minecraft']),
    name: line,
    port: z.number().int().min(1024).max(65535),
    players: z.number().int().min(1).max(128),
    map: z
      .string()
      .max(180)
      .regex(/^\/levels\/[a-zA-Z0-9_/-]+\/info\.json$/)
      .default('/levels/gridmap_v2/info.json'),
    maxCars: z.number().int().min(1).max(20).default(2),
    public: z.boolean().default(false),
    memory: z.number().int().min(512).max(32768).default(2048),
    world: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('world'),
    difficulty: z.enum(['peaceful', 'easy', 'normal', 'hard']).default('normal'),
    gamemode: z.enum(['survival', 'creative', 'adventure', 'spectator']).default('survival'),
    core: z.enum(['vanilla', 'paper']).default('vanilla'),
    authKey: z
      .string()
      .max(200)
      .regex(/^[a-zA-Z0-9-]*$/)
      .optional(),
    eula: z.boolean().default(false),
    favorite: z.boolean().default(false),
  })
  .strict();
export type ServerInput = z.infer<typeof serverInput>;
export type ServerRecord = Omit<ServerInput, 'authKey'> & {
  id: string;
  createdAt: string;
  hasSecret: boolean;
  installed: boolean;
  root: string;
  status: 'stopped' | 'running' | 'stopping' | 'error';
  pid?: number;
  memoryMB?: number;
  cpu?: number;
  lastError?: string;
};
export type LogLine = { time: string; text: string; stream: 'out' | 'error' | 'system' };
export type Backup = { id: string; createdAt: string; bytes: number; sha256: string };
export type Content = { name: string; bytes: number; enabled: boolean };
export type Stats = {
  totalMB: number;
  freeMB: number;
  cpu: number;
  freeDiskGB: number | null;
  addresses: string[];
  root: string;
};
export type Check = { label: string; ok: boolean; detail: string };
export type Game = {
  id: GameId;
  title: string;
  subtitle: string;
  genre: string;
  color: string;
  mark: string;
  support: 'early' | 'planned' | 'hosted';
  description: string;
  docs: string;
};
export type Snapshot = { servers: ServerRecord[]; stats: Stats; games: Game[]; version: string };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export type Action =
  | 'snapshot'
  | 'create'
  | 'update'
  | 'start'
  | 'stop'
  | 'logs'
  | 'command'
  | 'install'
  | 'importBinary'
  | 'chooseJava'
  | 'diagnose'
  | 'openFolder'
  | 'content'
  | 'importContent'
  | 'toggleContent'
  | 'importWorld'
  | 'backups'
  | 'backup'
  | 'restore'
  | 'guide'
  | 'setRoot'
  | 'quit';
export interface HubAPI {
  call<T = unknown>(action: Action, payload?: unknown): Promise<T>;
}
