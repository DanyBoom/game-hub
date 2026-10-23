import React, { useEffect, useState } from 'react';
import type { NightcoopInfo, ServerInput, ServerRecord } from '../shared/contracts';
type Settings = ServerInput['nightcoop'];
export function NightcoopFields({
  value: n,
  set,
}: {
  value: Settings;
  set: (v: Settings) => void;
}) {
  const [names, setNames] = useState(n.hubNames.join('\n'));
  const patch = (key: keyof Settings, value: unknown) => set({ ...n, [key]: value });
  const num = (key: keyof Settings, label: string, min: number, max: number, hint: string) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input
        type="number"
        value={Number(n[key])}
        min={min}
        max={max}
        onChange={(e) => patch(key, Number(e.target.value))}
      />
      <small>{hint}</small>
    </label>
  );
  const check = (key: keyof Settings, label: string) => (
    <label className="checkbox" key={key}>
      <input
        type="checkbox"
        checked={Boolean(n[key])}
        onChange={(e) => patch(key, e.target.checked)}
      />
      {label}
    </label>
  );
  return (
    <>
      <p className="full-width">
        NightCoop Hub — Linux-хаб сессий и relay. Игровую сессию запускает один из игроков; мод
        NightCoop нужен на каждом игровом ПК. Хаб не содержит сам Cyberpunk 2077.
      </p>
      <label className="field">
        <span>Внешний адрес VPS</span>
        <input
          value={n.address}
          placeholder="hub.example.org"
          onChange={(e) => patch('address', e.target.value)}
        />
        <small>
          Домен или IPv4 без https:// и порта. Используется для строки подключения с отпечатком.
        </small>
      </label>
      <label className="field">
        <span>Регион хаба</span>
        <input value={n.region} onChange={(e) => patch('region', e.target.value)} />
      </label>
      <label className="field">
        <span>Потоки (shards)</span>
        <select
          value={n.shards}
          onChange={(e) =>
            patch('shards', e.target.value === 'auto' ? 'auto' : Number(e.target.value))
          }
        >
          <option value="auto">Авто: все ядра ОС</option>
          {Array.from({ length: 64 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <small>
          Для VPS с квотой CPU задайте число вручную. Дополнительные UDP-порты покажет вкладка
          NightCoop.
        </small>
      </label>
      {num(
        'maxClients',
        'Соединений на поток',
        1,
        4095,
        'Каждый игрок держит соединение с хабом, даже при прямом пути.',
      )}
      {num(
        'maxPerAddress',
        'Соединений с одного адреса',
        0,
        4095,
        '0 — без лимита. Значение учитывает игроков за одним NAT.',
      )}
      {num('maxSessions', 'Сессий на поток', 0, 4095, '0 — половина лимита соединений.')}
      {num(
        'maxGuests',
        'Гостевых соединений в сессии',
        1,
        4095,
        'Учитывает старые соединения при возвращении. Не увеличивает лимит игроков самого мода.',
      )}
      {num(
        'maxPacketKB',
        'Максимальный пакет, КиБ',
        64,
        32768,
        '8192 по умолчанию — для крупных сообщений игрового протокола.',
      )}
      {num(
        'idleSeconds',
        'Отключение неактивного соединения, с',
        0,
        3600,
        '0 — не отключать. Для соединений вне сессии.',
      )}
      <label className="field">
        <span>Connection cookie</span>
        <select value={n.cookie} onChange={(e) => patch('cookie', e.target.value)}>
          <option value="pressure">Требовать под нагрузкой</option>
          <option value="always">Требовать всегда</option>
          <option value="off">Отключено</option>
        </select>
      </label>
      {num(
        'cookieBusy',
        'Порог занятых слотов для cookie',
        0,
        4095,
        '0 — автоматический порог: половина слотов.',
      )}
      {num(
        'guardPoolMB',
        'Общий пул ожидающих данных, МиБ',
        16,
        4096,
        'Распределяется между потоками; процесс также использует память на соединения.',
      )}
      {num(
        'maxQueueKB',
        'Очередь на получателя, КиБ',
        0,
        1048576,
        '0 — без лимита. Переполненное соединение закрывается.',
      )}
      {num(
        'receiveBufferKB',
        'UDP receive buffer, КиБ',
        0,
        1048576,
        'Linux ограничивает значение net.core.rmem_max. 0 — значение ENet.',
      )}
      {num(
        'statsSeconds',
        'Интервал статистики, с',
        0,
        86400,
        '0 — выключить статистику. Изменение интервала явно включает периодический вывод.',
      )}
      {num('runSeconds', 'Остановиться через, с', 0, 604800, '0 — работать до команды остановки.')}
      <label className="field full-width">
        <span>Имена в собственном сертификате</span>
        <textarea
          value={names}
          onChange={(e) => setNames(e.target.value)}
          onBlur={() => patch('hubNames', names.split(/[,\s]+/).filter(Boolean))}
          rows={2}
        />
        <small>
          Доменные имена или IPv4, по одному на строку. Доверие игроков определяется отпечатком.
        </small>
      </label>
      {check('guard', 'Защита очередей ENet')}
      {check('resume', 'Возобновление сессий после перезапуска')}
      {check('statsAlways', 'Показывать статистику даже без активности')}
      {check('logToFile', 'Дополнительный журнал в logs (без ротации самим хабом)')}
      {check('useHubCert', 'Использовать загруженный сертификат проекта hub.cert')}
      {check('useHubList', 'Использовать подписанный список hub-list.bin')}
      {check('useLocations', 'Использовать locations.txt')}
      {check('bench', 'Режим нагрузочного теста: отключает лимиты адреса и создания/поиска сессий')}
      <p className="full-width">
        Приватный хаб работает без сертификата проекта и его списков: используется собственный ключ
        с отпечатком. Корневой секретный ключ проекта должен оставаться у его владельца.
      </p>
    </>
  );
}
export function NightcoopPanel({
  server: s,
  notify,
}: {
  server: ServerRecord;
  notify: (text: string) => void;
}) {
  const [info, setInfo] = useState<NightcoopInfo>(),
    [busy, setBusy] = useState(false);
  const load = () =>
    window
      .gamehub!.call<NightcoopInfo>('nightcoopInfo', s.id)
      .then(setInfo)
      .catch((e) => notify(e.message));
  useEffect(() => {
    void load();
  }, [s.id, s.installed, s.nightcoop.address, s.port, s.nightcoop.shards]);
  const upload = async (name: string, file?: File) => {
    if (!file) return;
    if (file.size > 1024 ** 2) return notify('Лимит файла — 1 МБ');
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
      await window.gamehub!.call('nightcoopFile', { id: s.id, name, base64 });
      await load();
      notify('Публичный файл проверен и включён');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>NightCoop — подключение игроков</h2>
        <button className="secondary small" onClick={() => void load()}>
          Обновить отпечаток
        </button>
      </div>
      <p>
        Нужные UDP-порты: <strong>{info?.ports.join(', ') || 'уточняются'}</strong>. Откройте их в
        firewall VPS и у провайдера. TCP для игрового хаба не нужен.
      </p>
      {info?.fingerprint ? (
        <>
          <label className="field">
            <span>Адрес для игрового меню NightCoop</span>
            <input readOnly value={info.address} />
          </label>
          <button
            className="primary"
            onClick={() =>
              void navigator.clipboard
                .writeText(info.address || '')
                .then(() => notify('Адрес с отпечатком скопирован'))
            }
          >
            Копировать адрес с отпечатком
          </button>
          <p>
            В моде: «Совместная игра» → «Сервер» → «Добавить свой сервер». Затем хост создаёт сессию
            и передаёт гостю приглашение.
          </p>
          <label className="field">
            <span>Публичные ключи для владельца сертификата проекта</span>
            <textarea readOnly rows={5} value={info.publicKeys} />
          </label>
        </>
      ) : (
        <p>
          Сначала установите хаб: GameHub соберёт программу и создаст личный ключ. Затем здесь
          появится публичный отпечаток.
        </p>
      )}
      <p>
        Ключ hub-sign.key не передаётся браузеру и не включается в игровые ZIP-копии. Для переноса
        идентичности сохраните приватные данные всей панели. Потеря ключа изменит отпечаток.
      </p>
      <h3>Публичные файлы проекта (необязательно)</h3>
      <p>
        Они не нужны обычному частному хабу. Загрузки проверяются родной программой; секретные ключи
        сюда не загружаются.
      </p>
      {(['hub.cert', 'hub-list.bin', 'locations.txt'] as const).map((name) => (
        <label className="field" key={name}>
          <span>{name}</span>
          <input
            type="file"
            disabled={busy || s.status !== 'stopped' || !s.installed}
            onChange={(e) => void upload(name, e.target.files?.[0])}
          />
        </label>
      ))}
      <p>
        Источник: Twenfys/nightcoop-hub · {info?.source.slice(0, 12)}. Прочие настройки — во
        вкладках «Настройки» и «Все параметры».
      </p>
    </section>
  );
}
