import React, { useEffect, useState } from 'react';
import type { ConfigDocument, ServerRecord, Choice } from '../shared/contracts';
const names: Record<string, string> = {
  SERVER: 'Сервер',
  NAME: 'Название',
  CARS: 'Машины',
  TRACK: 'Трасса',
  PRACTICE: 'Практика',
  QUALIFY: 'Квалификация',
  RACE: 'Гонка',
  LAPS: 'Круги',
  TIME: 'Время',
  sessions: 'Сессии',
  sessionType: 'Тип сессии',
  sessionDurationMinutes: 'Продолжительность, мин',
  hourOfDay: 'Час',
  dayOfWeekend: 'День уик-энда',
  timeMultiplier: 'Множитель времени',
  entries: 'Участники',
  drivers: 'Пилоты',
  playerID: 'ID игрока',
  firstName: 'Имя',
  lastName: 'Фамилия',
  shortName: 'Короткое имя',
  raceNumber: 'Номер',
  forcedCarModel: 'Модель машины',
  ballastKg: 'Балласт, кг',
  restrictor: 'Рестриктор',
  MODEL: 'Машина',
  SKIN: 'Ливрея',
  DRIVERNAME: 'Имя пилота',
  TEAM: 'Команда',
  GUID: 'Steam GUID',
  BALLAST: 'Балласт',
  RESTRICTOR: 'Рестриктор',
};
function blank(value: any): any {
  if (Array.isArray(value)) return [];
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, blank(v)]));
  return typeof value === 'number' ? 0 : typeof value === 'boolean' ? false : '';
}
function rowTemplate(path: string): Record<string, any> {
  if (path.includes('whitelist') && path.endsWith('.entries')) return { uuid: '', name: '' };
  if (path.includes('ops.json') && path.endsWith('.entries'))
    return { uuid: '', name: '', level: 4, bypassesPlayerLimit: false };
  if (path.endsWith('.drivers'))
    return { firstName: '', lastName: '', shortName: '', driverCategory: 0, playerID: '' };
  if (path.includes('entrylist') && path.endsWith('.entries'))
    return {
      drivers: [rowTemplate('.drivers')],
      raceNumber: -1,
      forcedCarModel: -1,
      overrideDriverInfo: 0,
      defaultGridPosition: -1,
      ballastKg: 0,
      restrictor: 0,
      isServerAdmin: 0,
    };
  if (path.includes('bop') && path.endsWith('.entries'))
    return { track: 'monza', carModel: 0, ballastKg: 0, restrictor: 0 };
  if (path.endsWith('.allowed_cars_list_full')) return { car_name: '', ballast: 0, restrictor: 0 };
  return {};
}
function AddProperty({ add }: { add: (key: string, value: unknown) => void }) {
  const [key, setKey] = useState(''),
    [kind, setKind] = useState('string');
  return (
    <div className="add-property">
      <input
        aria-label="Имя нового параметра"
        placeholder="Имя параметра / секции"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <select
        aria-label="Тип нового параметра"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
        <option value="string">Текст</option>
        <option value="number">Число</option>
        <option value="boolean">Переключатель</option>
        <option value="object">Группа</option>
        <option value="array">Список</option>
      </select>
      <button
        className="secondary small"
        disabled={!key.trim() || ['__proto__', 'prototype', 'constructor'].includes(key)}
        onClick={() => {
          add(
            key,
            kind === 'object'
              ? {}
              : kind === 'array'
                ? []
                : kind === 'boolean'
                  ? false
                  : kind === 'number'
                    ? 0
                    : '',
          );
          setKey('');
        }}
      >
        Добавить параметр
      </button>
    </div>
  );
}
function Tree({
  value,
  change,
  label,
  path = '',
}: {
  value: any;
  change: (v: any) => void;
  label: string;
  path?: string;
}) {
  if (Array.isArray(value))
    return (
      <fieldset className="config-group">
        <legend>
          {label} · {value.length}
        </legend>
        {value.map((v, i) => (
          <div className="config-array-row" key={i}>
            <Tree
              value={v}
              change={(next) => change(value.map((old, j) => (i === j ? next : old)))}
              label={'#' + (i + 1)}
              path={path + '.' + i}
            />
            <button
              className="secondary small"
              onClick={() => change(value.filter((_, j) => j !== i))}
            >
              Убрать строку
            </button>
          </div>
        ))}
        <button
          className="secondary small"
          onClick={() => change([...value, value.length ? blank(value[0]) : rowTemplate(path)])}
        >
          Добавить строку
        </button>
      </fieldset>
    );
  if (value && typeof value === 'object')
    return (
      <fieldset className="config-group">
        <legend>{label}</legend>
        <div className="form-grid">
          {Object.entries(value).map(([key, v]) => (
            <Tree
              key={key}
              value={v}
              change={(next) => change({ ...value, [key]: next })}
              label={`${names[key] ?? key} ${names[key] ? '(' + key + ')' : ''}`}
              path={path + '.' + key}
            />
          ))}
        </div>
        <AddProperty add={(key, next) => change({ ...value, [key]: next })} />
      </fieldset>
    );
  const isSecret = /password|authkey|token|secret/i.test(path);
  const options: Choice[] = path.endsWith('.sessionType')
    ? [
        { value: 'P', label: 'Практика' },
        { value: 'Q', label: 'Квалификация' },
        { value: 'R', label: 'Гонка' },
      ]
    : [];
  return (
    <label className="field">
      <span>{label}</span>
      {typeof value === 'boolean' ? (
        <input type="checkbox" checked={value} onChange={(e) => change(e.target.checked)} />
      ) : options.length ? (
        <select value={value} onChange={(e) => change(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={isSecret ? 'password' : typeof value === 'number' ? 'number' : 'text'}
          value={value === '__GAMEHUB_KEEP_SECRET__' ? '' : (value ?? '')}
          placeholder={
            value === '__GAMEHUB_KEEP_SECRET__' ? 'Сохранённый секрет — оставить без изменения' : ''
          }
          onChange={(e) =>
            change(typeof value === 'number' ? Number(e.target.value) : e.target.value)
          }
        />
      )}
    </label>
  );
}
export function ConfigEditor({
  server,
  notify,
  busy,
  save,
}: {
  server: ServerRecord;
  notify: (s: string) => void;
  busy: boolean;
  save: (name: string, data: Record<string, any>) => Promise<any>;
}) {
  const [documents, setDocuments] = useState<ConfigDocument[]>([]),
    [selected, setSelected] = useState(''),
    [changed, setChanged] = useState(false);
  useEffect(() => {
    void window
      .gamehub!.call<ConfigDocument[]>('configDocuments', server.id)
      .then((d) => {
        setDocuments(d);
        setSelected(d[0]?.name ?? '');
      })
      .catch((e) => notify(e.message));
  }, [server.id]);
  const document = documents.find((d) => d.name === selected);
  return (
    <div className="panel">
      <div className="section-heading">
        <h2>Все параметры официального сервера</h2>
        <button
          className="primary"
          disabled={
            busy || ['running', 'stopping'].includes(server.status) || !changed || !document
          }
          onClick={async () => {
            if (document) {
              const result = await save(document.name, document.data);
              if (result) {
                setDocuments(result);
                setChanged(false);
              }
            }
          }}
        >
          Сохранить файл
        </button>
      </div>
      <p>
        Здесь доступны все поля реальных конфигураций, включая участников, сессии и BoP. Неизвестные
        поля сохраняются. Перед сохранением создаётся резервная копия.
      </p>
      <select
        aria-label="Конфигурационный файл"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        {documents.map((d) => (
          <option key={d.name}>{d.name}</option>
        ))}
      </select>
      {document ? (
        <Tree
          path={document.name}
          label={document.name}
          value={document.data}
          change={(data) => {
            setDocuments(documents.map((d) => (d.name === selected ? { ...d, data } : d)));
            setChanged(true);
          }}
        />
      ) : (
        <div className="small-empty">
          Установите официальный сервер, чтобы загрузить его конфигурации.
        </div>
      )}
    </div>
  );
}
