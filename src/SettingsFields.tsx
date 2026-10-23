import React, { useEffect, useId, useState } from 'react';
import type { Choice, Game, GameOptions, ServerInput } from '../shared/contracts';
import { beamMaps } from '../shared/options';
const empty: GameOptions = {
  maps: beamMaps,
  tracks: [],
  cars: [],
  layouts: {},
  weather: [],
  steamInstalled: false,
};
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Combo({
  value,
  options,
  change,
  label,
  hint,
}: {
  value: string;
  options: Choice[];
  change: (v: string) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint}>
      <select
        aria-label={label + ' — список'}
        value={options.some((o) => o.value === value) ? value : '__custom'}
        onChange={(e) => {
          if (e.target.value !== '__custom') change(e.target.value);
          else change('');
        }}
      >
        <option value="__custom">Вписать своё…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        aria-label={label + ' — своё значение'}
        list={id}
        value={value}
        onChange={(e) => change(e.target.value)}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </datalist>
    </Field>
  );
}
export function ConfigFields({
  value: v,
  set,
  game,
  basics = true,
  serverId,
}: {
  value: ServerInput;
  set: (v: ServerInput) => void;
  game: Game;
  basics?: boolean;
  serverId?: string;
}) {
  const [options, setOptions] = useState<GameOptions>(empty),
    [versions, setVersions] = useState<Choice[]>([]),
    [versionError, setVersionError] = useState('');
  const patch = (key: keyof ServerInput, value: unknown) => set({ ...v, [key]: value });
  useEffect(() => {
    let alive = true;
    void window.gamehub
      ?.call<GameOptions>('gameOptions', serverId ?? game.id)
      .then((o) => {
        if (alive) setOptions(o);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [game.id, serverId]);
  useEffect(() => {
    if (game.id !== 'minecraft') return;
    let alive = true;
    setVersionError('');
    void window.gamehub
      ?.call<Choice[]>('versions', v.core)
      .then((o) => {
        if (alive) setVersions(o);
      })
      .catch(() => {
        if (alive)
          setVersionError(
            'Каталог недоступен. Можно вписать версию вручную и повторить установку позже.',
          );
      });
    return () => {
      alive = false;
    };
  }, [game.id, v.core]);
  const number = (key: keyof ServerInput, label: string, min: number, max: number, step = 1) => (
    <Field key={key} label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(v[key])}
        onChange={(e) => patch(key, Number(e.target.value))}
      />
    </Field>
  );
  const check = (key: keyof ServerInput, label: string) => (
    <label className="checkbox" key={key}>
      <input
        type="checkbox"
        checked={Boolean(v[key])}
        onChange={(e) => patch(key, e.target.checked)}
      />
      {label}
    </label>
  );
  const racing = ['assetto', 'acc', 'evo'].includes(game.id);
  return (
    <div className="form-grid">
      {basics && (
        <>
          <Field label="Название сервера">
            <input value={v.name} maxLength={100} onChange={(e) => patch('name', e.target.value)} />
          </Field>
          {game.id === 'valheim' ? (
            <p>Vanilla Valheim: до 10 игроков. Изменение лимита требует модификаций сервера.</p>
          ) : (
            number('players', 'Количество игроков', 1, 128)
          )}
          {number('port', 'Игровой порт', 1024, 65535)}
          <button
            type="button"
            className="secondary small"
            onClick={() =>
              void window.gamehub?.call<number>('freePort').then((port) => patch('port', port))
            }
          >
            Подобрать свободный порт
          </button>
        </>
      )}
      {game.id === 'beammp' && (
        <>
          <Combo
            label="Карта"
            value={v.map}
            options={options.maps}
            change={(value) => patch('map', value)}
            hint="Стандартные карты уже есть в BeamNG. Для своей карты перетащите ZIP и выберите обнаруженный путь."
          />
          {number('maxCars', 'Машин на игрока', 1, 20)}
          <Field
            label="AuthKey"
            hint="Хранится в защищённом хранилище GameHub. Пустое поле сохраняет прежний ключ."
          >
            <input
              type="password"
              autoComplete="off"
              value={v.authKey ?? ''}
              onChange={(e) => patch('authKey', e.target.value)}
            />
          </Field>
          <Field label="Описание">
            <input
              value={v.beamDescription}
              onChange={(e) => patch('beamDescription', e.target.value)}
            />
          </Field>
          <Field label="Теги">
            <input value={v.beamTags} onChange={(e) => patch('beamTags', e.target.value)} />
          </Field>
          {check('public', 'Публичный список серверов')}
          {check('beamGuests', 'Разрешить гостей')}
          {check('beamLogChat', 'Сохранять игровой чат в лог BeamMP')}
        </>
      )}
      {['valheim', 'terraria', 'factorio'].includes(game.id) && (
        <>
          <Field label="Имя мира">
            <input
              value={v.world}
              onChange={(e) => patch('world', e.target.value)}
              pattern="[a-zA-Z0-9_-]+"
            />
          </Field>
          <Field
            label="Пароль сервера"
            hint="Пустое поле сохраняет прежний пароль. Valheim: минимум 5 символов."
          >
            <input
              type="password"
              autoComplete="new-password"
              value={v.password ?? ''}
              onChange={(e) => patch('password', e.target.value)}
            />
          </Field>
          {game.id === 'valheim' ? (
            <>
              {check('crossplay', 'Crossplay через relay')}
              {check('public', 'Показывать в списке серверов')}
              <p className="full-width">
                Миры сохраняются в отдельной папке экземпляра. Для Steam-соединений нужны игровой и
                следующий UDP-порты. Crossplay подключается по коду или внешнему адресу.
              </p>
            </>
          ) : (
            <>
              <Field label="Сид мира" hint="Применяется при создании нового мира.">
                <input value={v.seed} onChange={(e) => patch('seed', e.target.value)} />
              </Field>
              {game.id === 'terraria' ? (
                <>
                  <Field label="Размер мира">
                    <select
                      value={v.worldSize}
                      onChange={(e) => patch('worldSize', Number(e.target.value))}
                    >
                      <option value={1}>Маленький</option>
                      <option value={2}>Средний</option>
                      <option value={3}>Большой</option>
                    </select>
                  </Field>
                  <Field label="Сложность мира">
                    <select
                      value={v.worldMode}
                      onChange={(e) => patch('worldMode', Number(e.target.value))}
                    >
                      <option value={0}>Classic</option>
                      <option value={1}>Expert</option>
                      <option value={2}>Master</option>
                      <option value={3}>Journey</option>
                    </select>
                  </Field>
                  <p className="full-width">
                    Это vanilla Terraria. tModLoader требует отдельной реализации; моды tModLoader
                    сюда не устанавливаются.
                  </p>
                </>
              ) : (
                <>
                  {check('autoPause', 'Пауза без игроков')}
                  {number('autosaveMinutes', 'Автосохранение, мин', 1, 120)}
                </>
              )}
            </>
          )}
        </>
      )}
      {game.id === 'minecraft' && (
        <>
          <Field label="Серверное ядро">
            <select
              aria-label="Серверное ядро"
              value={v.core}
              onChange={(e) => patch('core', e.target.value)}
            >
              {['vanilla', 'paper', 'fabric', 'forge', 'neoforge'].map((c) => (
                <option key={c} value={c}>
                  {
                    (
                      {
                        vanilla: 'Vanilla',
                        paper: 'Paper — плагины',
                        fabric: 'Fabric — моды',
                        forge: 'Forge — моды',
                        neoforge: 'NeoForge — моды',
                      } as any
                    )[c]
                  }
                </option>
              ))}
            </select>
          </Field>
          <Combo
            label="Версия Minecraft"
            value={v.version}
            options={versions}
            change={(value) => patch('version', value)}
            hint={
              versionError ||
              'Пустое значение — последний релиз. Ядро и Java устанавливаются одной кнопкой.'
            }
          />
          {number('memory', 'RAM, МБ', 512, 32768, 512)}
          <Field
            label="Сид мира"
            hint="Пустое значение — случайный сид. Применяется при создании нового мира."
          >
            <input value={v.seed} onChange={(e) => patch('seed', e.target.value)} />
          </Field>
          <Field label="Папка мира">
            <input value={v.world} onChange={(e) => patch('world', e.target.value)} />
          </Field>
          <Field label="Генерация мира">
            <select value={v.levelType} onChange={(e) => patch('levelType', e.target.value)}>
              {[
                ['minecraft:normal', 'Обычный'],
                ['minecraft:flat', 'Плоский'],
                ['minecraft:large_biomes', 'Большие биомы'],
                ['minecraft:amplified', 'Усиленный рельеф'],
                ['minecraft:single_biome_surface', 'Один биом'],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Сложность">
            <select value={v.difficulty} onChange={(e) => patch('difficulty', e.target.value)}>
              {['peaceful', 'easy', 'normal', 'hard'].map((d, i) => (
                <option key={d} value={d}>
                  {['Мирная', 'Лёгкая', 'Обычная', 'Сложная'][i]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Режим игры">
            <select value={v.gamemode} onChange={(e) => patch('gamemode', e.target.value)}>
              {['survival', 'creative', 'adventure', 'spectator'].map((d, i) => (
                <option key={d} value={d}>
                  {['Выживание', 'Творчество', 'Приключение', 'Наблюдатель'][i]}
                </option>
              ))}
            </select>
          </Field>
          {number('viewDistance', 'Дальность прорисовки, чанки', 2, 32)}
          {number('simulationDistance', 'Дальность симуляции, чанки', 2, 32)}
          {number('spawnProtection', 'Защита спавна, блоки', 0, 1024)}
          {check('pvp', 'PvP')}
          {check('hardcore', 'Хардкор')}
          {check('whitelist', 'Только белый список')}
          {check('generateStructures', 'Генерировать структуры')}
          {check('allowFlight', 'Разрешить полёт')}
          {check('commandBlocks', 'Командные блоки')}
          {check('allowNether', 'Нижний мир')}
          {check('forceGamemode', 'Принудительный режим игры')}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={v.eula}
              onChange={(e) => patch('eula', e.target.checked)}
            />
            Я прочитал и принимаю Minecraft EULA на minecraft.net/eula
          </label>
        </>
      )}
      {racing && (
        <>
          <Combo
            label="Трасса"
            value={v.track}
            options={options.tracks}
            change={(value) => patch('track', value)}
            hint="Список из установленной игры/официального сервера. Свой ID можно вписать вручную."
          />
          {game.id !== 'acc' && (
            <Combo
              label="Конфигурация трассы"
              value={v.trackLayout}
              options={options.layouts[v.track] ?? []}
              change={(value) => patch('trackLayout', value)}
            />
          )}
          {game.id !== 'acc' && (
            <div className="field full-width">
              <span>Разрешённые автомобили · {v.cars.length}</span>
              <div className="car-choices">
                {options.cars.map((c) => (
                  <label className="checkbox" key={c.value}>
                    <input
                      type="checkbox"
                      checked={v.cars.includes(c.value)}
                      onChange={(e) =>
                        patch(
                          'cars',
                          e.target.checked
                            ? [...v.cars, c.value]
                            : v.cars.filter((id) => id !== c.value),
                        )
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
              <input
                aria-label="Автомобили — ID через точку с запятой"
                value={v.cars.join(';')}
                onChange={(e) =>
                  patch(
                    'cars',
                    e.target.value
                      .split(';')
                      .map((c) => c.trim())
                      .filter(Boolean),
                  )
                }
              />
            </div>
          )}
          {game.id !== 'acc' && number('httpPort', 'HTTP-порт игрового сервера', 1024, 65535)}
          <Field label="Пароль игроков" hint="Пустое поле сохраняет прежний пароль.">
            <input
              type="password"
              autoComplete="new-password"
              value={v.password ?? ''}
              onChange={(e) => patch('password', e.target.value)}
            />
          </Field>
          <Field label="Пароль администратора">
            <input
              type="password"
              autoComplete="new-password"
              value={v.adminPassword ?? ''}
              onChange={(e) => patch('adminPassword', e.target.value)}
            />
          </Field>
          {number('practiceMinutes', 'Практика, мин (0 — выключить)', 0, 1440)}
          {number('qualifyMinutes', 'Квалификация, мин (0 — выключить)', 0, 1440)}
          {number('raceMinutes', 'Гонка, мин', 1, 1440)}
          {game.id === 'assetto' && number('raceLaps', 'Кругов в гонке', 0, 1000)}
          {number('timeOfDay', 'Время суток, час', 0, 23)}
          {number('timeMultiplier', 'Множитель времени', 1, 60)}
          {number('ambientTemp', 'Температура воздуха, °C', -20, 60)}
          {game.id === 'assetto' ? (
            <>
              <Combo
                label="Погода"
                value={v.weather}
                options={
                  options.weather.length
                    ? options.weather
                    : [
                        { value: '3_clear', label: 'Ясно' },
                        { value: '7_heavy_clouds', label: 'Облачно' },
                      ]
                }
                change={(value) => patch('weather', value)}
              />
              {number('roadTemp', 'Температура трассы, °C', -20, 80)}
              {number('grip', 'Начальное сцепление, %', 0, 100)}
              {number('fuelRate', 'Расход топлива, %', 0, 500)}
              {number('tyreWear', 'Износ шин, %', 0, 500)}
              {number('damage', 'Повреждения, %', 0, 100)}
              {(['abs', 'tc'] as const).map((key) => (
                <Field key={key} label={key === 'abs' ? 'ABS' : 'Traction Control'}>
                  <select value={v[key]} onChange={(e) => patch(key, Number(e.target.value))}>
                    <option value={0}>Запрещено</option>
                    <option value={1}>Заводская система</option>
                    <option value={2}>Разрешено</option>
                  </select>
                </Field>
              ))}
            </>
          ) : (
            <>
              {number('cloud', 'Облачность', 0, 1, 0.05)}
              {number('rain', 'Дождь', 0, 1, 0.05)}
            </>
          )}
          {game.id === 'acc' && (
            <>
              <Field label="Класс автомобилей">
                <select value={v.carGroup} onChange={(e) => patch('carGroup', e.target.value)}>
                  {['FreeForAll', 'GT3', 'GT4', 'GTC', 'TCX', 'GT2'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              {number('safetyRating', 'Минимальный Safety Rating (-1 — без лимита)', -1, 99)}
              {number('trackMedals', 'Медали трассы', 0, 3)}
              {number('formationLap', 'Тип формировочного круга', 0, 5)}
              {number('mandatoryPits', 'Обязательных пит-стопов', 0, 20)}
              {number('pitWindowLength', 'Пит-окно, мин (-1 — без окна)', -1, 1440)}
              {number('driverStint', 'Длина стинта, мин (-1 — без лимита)', -1, 1440)}
              {number('maxTotalDriving', 'Общее время пилота, мин (-1 — без лимита)', -1, 1440)}
              {check('refuellingAllowed', 'Дозаправка в гонке')}
              {check('tyreChangeRequired', 'Обязательная смена шин')}
            </>
          )}
          {game.id === 'evo' && (
            <>
              <Field label="Тип события EVO">
                <select value={v.evoMode} onChange={(e) => patch('evoMode', e.target.value)}>
                  <option value="GameModeType_RACE_WEEKEND">Гоночный уик-энд</option>
                  <option value="GameModeType_PRACTICE">Практика</option>
                </select>
              </Field>
              <Field label="Погода EVO">
                <select value={v.evoWeather} onChange={(e) => patch('evoWeather', e.target.value)}>
                  {[
                    'CLEAR',
                    'SCATTERED_CLOUDS',
                    'BROKEN_CLOUDS',
                    'OVERCAST',
                    'DRIZZLE',
                    'RAIN',
                    'HEAVY_RAIN',
                  ].map((id, i) => (
                    <option key={id} value={'GameModeSelectionWeatherType_' + id}>
                      {
                        [
                          'Ясно',
                          'Редкая облачность',
                          'Облачно',
                          'Пасмурно',
                          'Морось',
                          'Дождь',
                          'Сильный дождь',
                        ][i]
                      }
                    </option>
                  ))}
                </select>
              </Field>
              {number('evoWarmup', 'Разминка, мин', 0, 1440)}
              {number('grip', 'Начальное сцепление, %', 0, 100)}
              {check('evoWeatherDynamic', 'Динамическая погода')}
              {check('evoCycle', 'Повторять событие по кругу')}
              {check('evoRanked', 'Рейтинговый сервер')}
            </>
          )}
          {check('public', 'Публиковать в игровом лобби')}
          <div className="notice full-width">
            Все остальные параметры, участники, BoP и дополнительные сессии доступны во вкладке «Все
            параметры» как формы реальных конфигурационных файлов.
          </div>
        </>
      )}
    </div>
  );
}
