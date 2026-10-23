import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { HubAPI, Reply, Action } from '../shared/contracts';
import './style.css';
import './extended.css';
let csrf = '';
async function request<T>(url: string, value?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GameHub-CSRF': csrf },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
  if (response.status === 401 && url !== '/api/login' && url !== '/api/session') {
    location.reload();
    throw new Error('Сессия завершена');
  }
  const reply: Reply<T> = await response.json();
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
async function upload(id: string, files: File[], kind = 'auto') {
  if (
    files.length &&
    !confirm(
      'Загрузить ' +
        files.map((f) => f.name).join(', ') +
        '? Перед импортом будет создана копия. Моды и плагины могут выполнять код на сервере.',
    )
  )
    return;
  let result: unknown;
  if (files.length > 30) throw new Error('Не более 30 файлов');
  for (const file of files) {
    const response = await fetch(
      `/api/upload?id=${encodeURIComponent(id)}&kind=${kind}&name=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-GameHub-CSRF': csrf },
        body: file,
      },
    );
    const reply = await response.json();
    if (!reply.ok) throw new Error(reply.error);
    result = reply.data;
  }
  return result;
}
const api: HubAPI = {
  dropFiles: upload,
  async call<T>(action: Action, payload?: unknown) {
    if (action === 'setRoot' || action === 'chooseJava' || action === 'importBinary')
      throw new Error(
        'Папка и зависимости управляются установщиком сервера; используйте автоматическую установку',
      );
    if (action === 'quit') {
      await request('/api/logout', {});
      location.reload();
      return undefined as T;
    }
    if (
      action === 'restore' &&
      !confirm('Восстановить резервную копию? Текущая папка будет сохранена рядом.')
    )
      return undefined as T;
    if (action === 'importContent' || action === 'importWorld') {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.zip,.jar,.lua';
      const files = await new Promise<File[]>((resolve) => {
        input.onchange = () => resolve(Array.from(input.files ?? []));
        input.oncancel = () => resolve([]);
        input.click();
      });
      const p = payload as { id: string; kind: string } | string;
      return (await upload(
        typeof p === 'string' ? p : p.id,
        files,
        action === 'importWorld' ? 'world' : typeof p === 'string' ? 'auto' : p.kind,
      )) as T;
    }
    const result = await request<T>('/api/action', { action, payload });
    if (action === 'openFolder') alert('Папка на выделенном сервере: ' + result);
    if (action === 'guide' && typeof result === 'string')
      window.open(result, '_blank', 'noopener,noreferrer');
    return result;
  },
};
window.gamehub = api;
async function open() {
  await import('./main');
  createRoot(document.getElementById('session-controls')!).render(
    <div className="web-session">
      <span>GameHub Server · HTTPS</span>
      <button onClick={() => void api.call('quit')}>Выйти</button>
    </div>,
  );
}
function Login() {
  const [login, setLogin] = useState('admin'),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <main className="web-login">
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const result = await request<{ csrf: string }>('/api/login', { login, password });
            csrf = result.csrf;
            loginRoot.unmount();
            await open();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">GAMEHUB SERVER</span>
        <h1>Ваши серверы — под контролем.</h1>
        <p>Логин и пароль выдаёт установщик на выделенном сервере.</p>
        <label className="field">
          <span>Логин</span>
          <input
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </main>
  );
}
const loginRoot = createRoot(document.getElementById('root')!);
request<{ csrf: string }>('/api/session')
  .then(async (s) => {
    csrf = s.csrf;
    loginRoot.unmount();
    await open();
  })
  .catch(() => loginRoot.render(<Login />));
