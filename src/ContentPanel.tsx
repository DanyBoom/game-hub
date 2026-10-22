import React, { useEffect, useState } from 'react';
import { Upload, Plus, Layers } from 'lucide-react';
import type { Action, Content, ContentKind, ServerRecord } from '../shared/contracts';
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
    [kind, setKind] = useState<ContentKind>('auto');
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
  const unsupported = ['acc', 'evo'].includes(s.game);
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
          Официальный сервер этой игры использует собственный контент. Пользовательские машины и
          трассы ZIP не устанавливаются. Сессии, участники, BoP и остальные настройки доступны во
          вкладке «Все параметры».
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
          {content.length ? (
            <div className="file-list">
              {content.map((f) => (
                <div key={f.name + (f.enabled ? '1' : '0')}>
                  <Layers size={18} />
                  <strong>{f.name}</strong>
                  <span>{f.bytes ? (f.bytes / 1024 ** 2).toFixed(1) + ' МБ' : 'Папка'}</span>
                  <button
                    className="secondary small"
                    disabled={busy || running}
                    onClick={async () => {
                      await run('toggleContent', { id: s.id, name: f.name });
                      await reload();
                    }}
                  >
                    {f.enabled ? 'Отключить' : 'Включить'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="small-empty">Добавленного контента пока нет</div>
          )}
        </>
      )}
    </div>
  );
}
