import { z } from 'zod';
export const gameId = z.enum([
  'beammp',
  'minecraft',
  'assetto',
  'valheim',
  'terraria',
  'factorio',
  'evo',
  'acc',
  'lmu',
]);
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
    game: z.enum([
      'beammp',
      'minecraft',
      'assetto',
      'acc',
      'evo',
      'valheim',
      'terraria',
      'factorio',
    ]),
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
    core: z.enum(['vanilla', 'paper', 'fabric', 'forge', 'neoforge']).default('vanilla'),
    version: z
      .string()
      .max(60)
      .regex(/^[a-zA-Z0-9._+-]*$/)
      .default(''),
    seed: z
      .string()
      .max(120)
      .refine((s) => !/[\r\n\x00]/.test(s))
      .default(''),
    levelType: z
      .enum([
        'minecraft:normal',
        'minecraft:flat',
        'minecraft:large_biomes',
        'minecraft:amplified',
        'minecraft:single_biome_surface',
      ])
      .default('minecraft:normal'),
    viewDistance: z.number().int().min(2).max(32).default(10),
    simulationDistance: z.number().int().min(2).max(32).default(10),
    spawnProtection: z.number().int().min(0).max(1024).default(16),
    pvp: z.boolean().default(true),
    hardcore: z.boolean().default(false),
    whitelist: z.boolean().default(false),
    generateStructures: z.boolean().default(true),
    allowFlight: z.boolean().default(false),
    commandBlocks: z.boolean().default(false),
    allowNether: z.boolean().default(true),
    forceGamemode: z.boolean().default(false),
    beamDescription: z
      .string()
      .max(500)
      .refine((s) => !/[\r\n\x00]/.test(s))
      .default(''),
    beamTags: z
      .string()
      .max(200)
      .refine((s) => !/[\r\n\x00]/.test(s))
      .default('Freeroam'),
    beamGuests: z.boolean().default(false),
    beamLogChat: z.boolean().default(false),
    httpPort: z.number().int().min(1024).max(65535).default(8081),
    track: z
      .string()
      .max(100)
      .refine((s) => !/[\r\n\x00]/.test(s))
      .default(''),
    trackLayout: z
      .string()
      .max(100)
      .refine((s) => !/[\r\n\x00]/.test(s))
      .default(''),
    evoMode: z
      .enum(['GameModeType_RACE_WEEKEND', 'GameModeType_PRACTICE'])
      .default('GameModeType_RACE_WEEKEND'),
    evoWeather: z
      .enum([
        'GameModeSelectionWeatherType_CLEAR',
        'GameModeSelectionWeatherType_SCATTERED_CLOUDS',
        'GameModeSelectionWeatherType_BROKEN_CLOUDS',
        'GameModeSelectionWeatherType_OVERCAST',
        'GameModeSelectionWeatherType_DRIZZLE',
        'GameModeSelectionWeatherType_RAIN',
        'GameModeSelectionWeatherType_HEAVY_RAIN',
      ])
      .default('GameModeSelectionWeatherType_CLEAR'),
    evoWeatherDynamic: z.boolean().default(false),
    evoWarmup: z.number().int().min(0).max(1440).default(0),
    evoCycle: z.boolean().default(true),
    evoRanked: z.boolean().default(false),
    cars: z
      .array(
        z
          .string()
          .max(100)
          .regex(/^[a-zA-Z0-9_-]+$/),
      )
      .max(200)
      .default([]),
    practiceMinutes: z.number().int().min(0).max(1440).default(10),
    qualifyMinutes: z.number().int().min(0).max(1440).default(10),
    raceMinutes: z.number().int().min(0).max(1440).default(20),
    raceLaps: z.number().int().min(0).max(1000).default(5),
    weather: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z0-9_-]*$/)
      .default('3_clear'),
    ambientTemp: z.number().min(-20).max(60).default(20),
    roadTemp: z.number().min(-20).max(80).default(26),
    rain: z.number().min(0).max(1).default(0),
    cloud: z.number().min(0).max(1).default(0.2),
    timeOfDay: z.number().int().min(0).max(23).default(12),
    timeMultiplier: z.number().min(1).max(60).default(1),
    fuelRate: z.number().int().min(0).max(500).default(100),
    tyreWear: z.number().int().min(0).max(500).default(100),
    damage: z.number().int().min(0).max(100).default(100),
    abs: z.number().int().min(0).max(2).default(1),
    tc: z.number().int().min(0).max(2).default(1),
    grip: z.number().min(0).max(100).default(98),
    carGroup: z.enum(['FreeForAll', 'GT3', 'GT4', 'GTC', 'TCX', 'GT2']).default('GT3'),
    safetyRating: z.number().int().min(-1).max(99).default(-1),
    trackMedals: z.number().int().min(0).max(3).default(0),
    formationLap: z.number().int().min(0).max(5).default(3),
    pitWindowLength: z.number().int().min(-1).max(1440).default(-1),
    mandatoryPits: z.number().int().min(0).max(20).default(0),
    refuellingAllowed: z.boolean().default(true),
    tyreChangeRequired: z.boolean().default(false),
    driverStint: z.number().int().min(-1).max(1440).default(-1),
    maxTotalDriving: z.number().int().min(-1).max(1440).default(-1),
    password: z
      .string()
      .max(120)
      .refine((s) => !/[\r\n\x00]/.test(s))
      .optional(),
    adminPassword: z
      .string()
      .max(120)
      .refine((s) => !/[\r\n\x00]/.test(s))
      .optional(),
    authKey: z
      .string()
      .max(200)
      .regex(/^[a-zA-Z0-9-]*$/)
      .optional(),
    eula: z.boolean().default(false),
    favorite: z.boolean().default(false),
    crossplay: z.boolean().default(false),
    worldSize: z.number().int().min(1).max(3).default(2),
    worldMode: z.number().int().min(0).max(3).default(0),
    autoPause: z.boolean().default(true),
    autosaveMinutes: z.number().int().min(1).max(120).default(10),
  })
  .strict();
export type ServerInput = z.infer<typeof serverInput>;
export type ServerRecord = Omit<ServerInput, 'authKey' | 'password' | 'adminPassword'> & {
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
  installation?: { phase: string; bytes?: number; total?: number; error?: string };
};
export type LogLine = { time: string; text: string; stream: 'out' | 'error' | 'system' };
export type Backup = { id: string; createdAt: string; bytes: number; sha256: string };
export type Content = { name: string; bytes: number; enabled: boolean };
export type ContentDetails = {
  name: string;
  bytes: number;
  sha256?: string;
  modifiedAt: string;
  configs: { name: string; text: string }[];
};
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
export type Snapshot = {
  servers: ServerRecord[];
  stats: Stats;
  games: Game[];
  version: string;
  platform?: string;
};
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export type Action =
  | 'freePort'
  | 'gameOptions'
  | 'versions'
  | 'configDocuments'
  | 'saveConfigDocument'
  | 'cancelInstall'
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
  | 'setContentEnabled'
  | 'removeContent'
  | 'contentDetails'
  | 'saveContentConfig'
  | 'importWorld'
  | 'backups'
  | 'backup'
  | 'restore'
  | 'guide'
  | 'setRoot'
  | 'quit';
export interface HubAPI {
  call<T = unknown>(action: Action, payload?: unknown): Promise<T>;
  dropFiles(id: string, files: File[], kind?: ContentKind): Promise<unknown>;
}
export type ContentKind = 'auto' | 'server' | 'world' | 'datapack';
export type Choice = { value: string; label: string };
export type GameOptions = {
  maps: Choice[];
  tracks: Choice[];
  cars: Choice[];
  layouts: Record<string, Choice[]>;
  weather: Choice[];
  steamInstalled: boolean;
};
export type ConfigDocument = {
  name: string;
  format: 'ini' | 'json' | 'properties';
  data: Record<string, any>;
};
