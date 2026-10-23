import React, { useEffect, useState } from 'react';
import { Upload, Plus, Layers } from 'lucide-react';
import type {
  Action,
  Content,
  ContentKind,
  ServerRecord,
  ContentDetails,
} from '../shared/contracts';
type Run = <T = unknown>(action: Action, payload?: unknown) => Promise<T | undefined>;
export function ContentPanel({
  server: s,
  busy,
  run,
  notify,
}: {
  server: ServerRecord;
  busy: boolean;
  run: Run;
  notify: (s: string) => void;
}) {
  const [content, setContent] = useState<Content[]>([]),
    [drag, setDrag] = useState(false),
    [loading, setLoading] = useState(false),
    [kind, setKind] = useState<ContentKind>('auto'),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [selected, setSelected] = useState<string[]>([]),
    [details, setDetails] = useState<ContentDetails | null>(null),
    [configFile, setConfigFile] = useState(''),
    [configText, setConfigText] = useState('');
  const reload = () =>
    window
      .gamehub!.call<Content[]>('content', s.id)
      .then(setContent)
      .catch((e) => notify(e.message));
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 2500);
    return () => clearInterval(t);
  }, [s.id]);
  const running = s.status === 'running' || s.status === 'stopping';
  const unsupported = ['acc', 'evo', 'valheim', 'terraria', 'nightcoop'].includes(s.game);
  const visible = content.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || f.enabled === (filter === 'enabled')),
  );
  const loadDetails = async (name: string) => {
    try {
      const d = await window.gamehub!.call<ContentDetails>('contentDetails', { id: s.id, name });
      setDetails(d);
      setConfigFile(d.configs[0]?.name ?? '');
      setConfigText(d.configs[0]?.text ?? '');
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const drop = async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDrag(false);
    if (running || busy || loading)
      return notify('Остановите сервер и дождитесь завершения операции');
    setLoading(true);
    try {
      const result: any = await window.gamehub!.dropFiles(
        s.id,
        Array.from(event.dataTransfer.files),
        kind,
      );
      await reload();
      notify(
        result?.maps?.length
          ? 'Карта обнаружена: ' + result.maps.join(', ')
          : 'Контент импортирован',
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="panel">
      <div className="section-heading">
        <h2>
          {s.game === 'assetto'
            ? 'Автомобили и трассы'
            : s.game === 'beammp'
              ? 'Карты, машины и Lua-плагины'
              : 'Моды, плагины и миры'}
        </h2>
        {!unsupported && (
          <button
            className="primary"
            disabled={busy || running || loading}
            onClick={async () => {
              await run('importContent', { id: s.id, kind });
              await reload();
            }}
          >
            <Plus size={16} />
            Добавить файлы
          </button>
        )}
      </div>
      {unsupported ? (
        <p>
          Для этого адаптера автоматический импорт модов пока не поддерживается. Официальный сервер
          этой игры использует собственный контент. Пользовательские машины и трассы ZIP не
          устанавливаются. Сессии, участники, BoP и остальные настройки доступны во вкладке «Все
          параметры».
        </p>
      ) : (
        <>
          <div
            className={'drop-zone ' + (drag ? 'dragging' : '')}
            role="region"
            aria-label="Перетащить контент"
            onDragEnter={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={drop}
          >
            <Upload size={35} />
            <h3>{loading ? 'Устанавливаем контент…' : 'Перетащите ZIP или JAR прямо сюда'}</h3>
            <p>
              {s.game === 'assetto'
                ? 'GameHub распознает cars / tracks и разложит файлы по папкам.'
                : s.game === 'beammp'
                  ? 'Карты и машины попадут в Resources/Client. Для Lua выберите «Серверные плагины».'
                  : 'Мир, datapack, мод или плагин определяются по содержимому архива и выбранному ядру.'}
            </p>
            {s.game !== 'assetto' && (
              <select
                aria-label="Тип импортируемого контента"
                value={kind}
                onChange={(e) => setKind(e.target.value as ContentKind)}
              >
                <option value="auto">Определить автоматически</option>
                {s.game === 'beammp' ? (
                  <option value="server">Серверные Lua-плагины</option>
                ) : (
                  <>
                    <option value="world">Мир Minecraft</option>
                    <option value="datapack">Datapack</option>
                  </>
                )}
              </select>
            )}
          </div>
          <p>
            Перед изменением создаётся резервная копия. Одинаковые файлы пропускаются по SHA-256;
            при замене прежний файл остаётся рядом. Импорт выполняется только после остановки
            сервера.
          </p>
          <div className="mod-toolbar">
            <input
              aria-label="Найти мод"
              placeholder="Поиск по названию…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Состояние модов"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Все ({content.length})</option>
              <option value="enabled">Включённые</option>
              <option value="disabled">Отключённые</option>
            </select>
            <button
              className="secondary small"
              onClick={() => setSelected(visible.map((f) => f.name))}
            >
              Выбрать найденные
            </button>
            <button
              className="secondary small"
              onClick={() => {
                setSelected([]);
                void reload();
              }}
            >
              Обновить
            </button>
          </div>
          {!!selected.length && (
            <div className="mod-toolbar">
              <span>Выбрано: {selected.length}</span>
              {[true, false].map((enabled) => (
                <button
                  key={String(enabled)}
                  className="secondary small"
                  disabled={busy || running || loading}
                  onClick={async () => {
                    await run('setContentEnabled', { id: s.id, names: selected, enabled });
                    setSelected([]);
                    await reload();
                  }}
                >
                  {enabled ? 'Включить выбранные' : 'Отключить выбранные'}
                </button>
              ))}
            </div>
          )}
          {content.length ? (
            <div className="file-list">
              {visible.map((f) => (
                <div key={f.name + (f.enabled ? '1' : '0')}>
                  <input
                    aria-label={'Выбрать ' + f.name}
                    type="checkbox"
                    checked={selected.includes(f.name)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, f.name]
                          : selected.filter((n) => n !== f.name),
                      )
                    }
                  />
                  <Layers size={18} />
                  <button className="text-button mod-name" onClick={() => void loadDetails(f.name)}>
                    {f.name}
                  </button>
                  <span className={'mod-status ' + (f.enabled ? 'enabled' : '')}>
                    {f.enabled ? 'Включён' : 'Отключён'}
                  </span>
                  <span>{f.bytes ? (f.bytes / 1024 ** 2).toFixed(1) + ' МБ' : 'Папка'}</span>
                  <button
                    className="secondary small"
                    disabled={busy || running}
                    onClick={async () => {
                      await run('toggleContent', { id: s.id, name: f.name });
                      setDetails(null);
                      await reload();
                    }}
                  >
                    {f.enabled ? 'Отключить' : 'Включить'}
                  </button>
                  <button className="secondary small" onClick={() => void loadDetails(f.name)}>
                    Настройки
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || running}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          'Убрать ' + f.name + ' в карантин? Будет создана резервная копия.',
                        )
                      )
                        return;
                      await run('removeContent', { id: s.id, name: f.name });
                      setDetails(null);
                      setSelected([]);
                      await reload();
                    }}
                  >
                    Убрать
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="small-empty">Добавленного контента пока нет</div>
          )}
          {details && (
            <section className="mod-details">
              <div className="section-heading">
                <h3>{details.name}</h3>
                <button className="text-button" onClick={() => setDetails(null)}>
                  Закрыть
                </button>
              </div>
              <p>
                Изменён: {new Date(details.modifiedAt).toLocaleString()} ·{' '}
                {Math.round(details.bytes / 1024)} КБ
              </p>
              {details.sha256 && <p className="mod-hash">SHA-256: {details.sha256}</p>}
              {details.configs.length ? (
                <>
                  <label className="field">
                    <span>Файл настроек мода</span>
                    <select
                      value={configFile}
                      onChange={(e) => {
                        setConfigFile(e.target.value);
                        setConfigText(
                          details.configs.find((c) => c.name === e.target.value)?.text ?? '',
                        );
                      }}
                    >
                      {details.configs.map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <textarea
                    className="mod-config"
                    aria-label="Содержимое настроек мода"
                    value={configText}
                    onChange={(e) => setConfigText(e.target.value)}
                    spellCheck={false}
                    disabled={running}
                  />
                  <button
                    className="primary"
                    disabled={busy || running}
                    onClick={async () => {
                      const d = await run<ContentDetails>('saveContentConfig', {
                        id: s.id,
                        name: details.name,
                        file: configFile,
                        text: configText,
                      });
                      if (d) {
                        setDetails(d);
                        notify('Настройки мода сохранены');
                      }
                    }}
                  >
                    Сохранить настройки мода
                  </button>
                  <p>
                    Изменения действуют после следующего запуска. Строки __GAMEHUB_SECRET_LINE…
                    скрывают секреты — сохраняйте их без изменений.
                  </p>
                </>
              ) : (
                <p>
                  Настройки мода ещё не найдены. Запустите сервер с этим модом один раз, затем
                  остановите его и обновите список. Для Minecraft ищутся совпадающие имена в
                  config/plugins, для BeamMP — текстовые настройки внутри папки Lua-плагина.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
