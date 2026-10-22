import React, { useState } from 'react';
import type { Action, ServerRecord } from '../shared/contracts';
export function PlayersPanel({
  server,
  run,
  busy,
}: {
  server: ServerRecord;
  run: <T = unknown>(action: Action, payload?: unknown) => Promise<T | undefined>;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const online = server.status === 'running';
  return (
    <div className="panel">
      <h2>Игроки Minecraft</h2>
      <p>
        Команды отправляются настоящему серверу. Результат отображается во вкладке «Консоль». Для
        управления сервер должен быть запущен.
      </p>
      <label className="field">
        <span>Игровой ник</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={16}
          placeholder="PlayerName"
        />
      </label>
      <div className="player-actions">
        {[
          ['whitelist add', 'В белый список'],
          ['whitelist remove', 'Убрать из белого списка'],
          ['op', 'Выдать оператора'],
          ['deop', 'Снять оператора'],
          ['ban', 'Заблокировать'],
          ['pardon', 'Разблокировать'],
        ].map(([command, label]) => (
          <button
            key={command}
            className="secondary"
            disabled={busy || !online || !/^[A-Za-z0-9_]{1,16}$/.test(name)}
            onClick={() => void run('command', { id: server.id, command: command + ' ' + name })}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        className="primary"
        disabled={busy || !online}
        onClick={() => void run('command', { id: server.id, command: 'list' })}
      >
        Показать игроков в консоли
      </button>
      <p>
        Офлайн-списки с UUID доступны во вкладке «Все параметры». Включить обязательный белый список
        можно в игровых настройках.
      </p>
    </div>
  );
}
