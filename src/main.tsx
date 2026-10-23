import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  ChevronsLeft,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  Globe,
  HardDrive,
  Heart,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  MemoryStick,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Square,
  Terminal,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type {
  Action,
  Backup,
  Check as Diagnostic,
  Content,
  Game,
  HubAPI,
  LogLine,
  ServerInput,
  ServerRecord,
  Snapshot,
} from '../shared/contracts';
import { serverInput } from '../shared/contracts';
import './style.css';
import './extended.css';
import { ConfigFields } from './SettingsFields';
import { ConfigEditor } from './ConfigEditor';
import { ContentPanel } from './ContentPanel';
import { NightcoopPanel } from './Nightcoop';
import { PlayersPanel } from './PlayersPanel';
declare global {
  interface Window {
    gamehub?: HubAPI;
  }
}
const api = window.gamehub;
const stateLabels = {
  stopped: 'Остановлен',
  running: 'Процесс запущен',
  stopping: 'Сохранение…',
  error: 'Требует внимания',
};
const supportLabels = {
  early: 'Ранний доступ',
  planned: 'В разработке',
  hosted: 'Внешний хостинг',
};
const gb = (mb: number) => (mb / 1024).toFixed(1) + ' ГБ';
const size = (n: number) =>
  n > 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + ' МБ' : (n / 1024).toFixed(1) + ' КБ';
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [page, setPage] = useState('dashboard');
  const [selected, setSelected] = useState<string>();
  const [wizard, setWizard] = useState<Game>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    if (api) setSnapshot(await api.call<Snapshot>('snapshot'));
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh().catch(() => {}), 2500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 9000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const run = async <T,>(action: Action, payload?: unknown): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await api!.call<T>(action, payload);
      await refresh();
      return result;
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!api)
    return (
      <div className="boot">
        <Gamepad2 size={42} />
        <h1>GameHub</h1>
        <p>Откройте приложение GameHub для Windows.</p>
        <p>Управление процессами доступно только в настольном приложении.</p>
      </div>
    );
  if (!snapshot)
    return (
      <div className="boot">
        <LoaderCircle className="spin" />
        <p>Открываем вашу игровую станцию…</p>
      </div>
    );
  const { servers, stats, games } = snapshot;
  const active = servers.filter((s) => s.status === 'running' || s.status === 'stopping');
  const current = servers.find((s) => s.id === selected);
  const navigate = (p: string) => {
    setPage(p);
    setSelected(undefined);
    setQuery('');
  };
  const open = (s: ServerRecord) => {
    setSelected(s.id);
    setPage('servers');
  };
  const game = (s: ServerRecord) => games.find((g) => g.id === s.game)!;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Gamepad2 size={25} />
          </div>
          <span>
            game<span className="violet">hub</span>
            <small>YOUR LOCAL PLAYGROUND</small>
          </span>
        </div>
        <div className="nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          {[
            [LayoutDashboard, 'dashboard', 'Обзор'],
            [Gamepad2, 'library', 'Библиотека игр'],
            [Server, 'servers', 'Мои серверы'],
            [BookOpen, 'guides', 'Руководства'],
          ].map(([Icon, id, label]) => (
            <button
              key={String(id)}
              className={page === id ? 'nav active' : 'nav'}
              onClick={() => navigate(String(id))}
            >
              <Icon size={19} />
              <span>{String(label)}</span>
              {id === 'servers' && <b>{servers.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="live-dot" />
            <div>
              {location.protocol === 'https:' ? 'Всё на вашем сервере' : 'Всё на вашем компьютере'}
              <small>
                {location.protocol === 'https:' ? 'Ваша личная панель' : 'Без аккаунтов и облака'}
              </small>
            </div>
            <ShieldCheck size={17} />
          </div>
          <button
            className={page === 'settings' ? 'nav active' : 'nav'}
            onClick={() => navigate('settings')}
          >
            <Settings size={19} />
            Настройки
          </button>
          <div className="version">
            <span>GAMEHUB {snapshot.version}</span>
            <span>ALPHA</span>
          </div>
        </div>
      </aside>
      <main
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          if (!current) {
            setToast('Откройте сервер, в который нужно добавить контент');
            return;
          }
          if (busy) {
            setToast('Дождитесь завершения операции');
            return;
          }
          setBusy(true);
          try {
            const result: any = await api!.dropFiles(
              current.id,
              Array.from(e.dataTransfer.files),
              'auto',
            );
            setToast(
              result?.maps?.length
                ? 'Карта обнаружена: ' + result.maps.join(', ')
                : 'Контент импортирован',
            );
            await refresh();
          } catch (error) {
            setToast((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header className="topbar">
          <div className="crumb">
            Рабочее пространство <ChevronRight size={14} />
            <strong>
              {current
                ? current.name
                : (
                    {
                      dashboard: 'Обзор',
                      library: 'Библиотека игр',
                      servers: 'Мои серверы',
                      guides: 'Руководства',
                      settings: 'Настройки',
                    } as Record<string, string>
                  )[page]}
            </strong>
          </div>
          <div className="top-right">
            <span className="windows-mark">⊞</span>{' '}
            {snapshot?.platform === 'linux' ? 'Linux Server' : 'Windows'} <i />{' '}
            <ShieldCheck size={15} />{' '}
            {location.protocol === 'https:' ? 'Серверная панель' : 'Локальный режим'}
          </div>
        </header>
        <div className="workspace">
          {current ? (
            <Details
              server={current}
              game={game(current)}
              run={run}
              busy={busy}
              stats={stats}
              back={() => setSelected(undefined)}
              notify={setToast}
            />
          ) : (
            <>
              <div className="page-title">
                <div>
                  <div className="eyebrow">ВАША ИГРОВАЯ СТАНЦИЯ</div>
                  <h1>
                    {
                      (
                        {
                          dashboard: 'Всё готово к игре.',
                          library: 'Выберите свою игру.',
                          servers: 'Ваши серверы.',
                          guides: 'Разберёмся вместе.',
                          settings: 'Под вашим контролем.',
                        } as Record<string, string>
                      )[page]
                    }
                  </h1>
                  <p>
                    {
                      (
                        {
                          dashboard:
                            'Собирайте друзей. Управляйте серверами. Играйте по своим правилам.',
                          library: 'Локальный хостинг, понятные настройки и никаких лишних окон.',
                          servers: 'Отдельные настройки, контент и сохранения для каждого сервера.',
                          guides: 'Практические шаги, ограничения и официальные источники.',
                          settings: 'Данные остаются на этом компьютере.',
                        } as Record<string, string>
                      )[page]
                    }
                  </p>
                </div>
                {!['settings', 'guides'].includes(page) && (
                  <button className="primary" onClick={() => navigate('library')}>
                    <Plus size={17} />
                    Создать сервер
                  </button>
                )}
              </div>
              {page === 'dashboard' && (
                <>
                  <div className="hero">
                    <div className="hero-grid" />
                    <div className="hero-content">
                      <span className="pill violet-pill">
                        <Zap size={13} /> ВАШ СЕРВЕР. ВАШИ ПРАВИЛА.
                      </span>
                      <h2>
                        Большие приключения.
                        <br />
                        На вашем компьютере.
                      </h2>
                      <p>
                        Одна библиотека для ваших игровых миров.
                        <br />
                        Выберите игру и установите сервер одной кнопкой.
                      </p>
                      <button className="primary" onClick={() => navigate('library')}>
                        Выбрать игру <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="hero-art" aria-hidden="true">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="server-tower">
                        <div>
                          <span />
                          <i />
                          <i />
                        </div>
                        <div>
                          <span />
                          <i />
                          <i />
                        </div>
                        <div>
                          <span />
                          <i />
                          <i />
                        </div>
                      </div>
                      <div className="floating-badge">
                        <Gamepad2 size={24} />
                      </div>
                      <div className="tiny-label">
                        <span className="live-dot" /> LOCAL HOST · ONLINE POTENTIAL
                      </div>
                    </div>
                    <span className="hero-number">01 / GAMEHUB</span>
                  </div>
                  <div className="stats-grid">
                    <Metric
                      icon={Server}
                      label="Активные процессы"
                      value={String(active.length)}
                      note={`${servers.length} серверов в библиотеке`}
                      accent
                    />
                    <Metric
                      icon={Cpu}
                      label="Загрузка процессора"
                      value={`${stats.cpu.toFixed(0)}%`}
                      percent={stats.cpu}
                      note="Измеряется на этом компьютере"
                    />
                    <Metric
                      icon={MemoryStick}
                      label="Оперативная память"
                      value={gb(stats.totalMB - stats.freeMB)}
                      percent={(1 - stats.freeMB / stats.totalMB) * 100}
                      note={`из ${gb(stats.totalMB)} доступно`}
                    />
                    <Metric
                      icon={HardDrive}
                      label="Свободно на диске"
                      value={stats.freeDiskGB === null ? '—' : `${stats.freeDiskGB} ГБ`}
                      note="Диск папки серверов"
                    />
                  </div>
                  <div className="section-heading">
                    <h2>
                      Мои серверы <span>{servers.length}</span>
                    </h2>
                    <button className="text-button" onClick={() => navigate('servers')}>
                      Все серверы <ArrowRight size={15} />
                    </button>
                  </div>
                  {servers.length ? (
                    <div className="server-grid">
                      {servers.slice(0, 3).map((s) => (
                        <ServerCard
                          key={s.id}
                          server={s}
                          game={game(s)}
                          open={() => open(s)}
                          run={run}
                          busy={busy}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-line">
                      <div className="empty-icon">
                        <Server size={23} />
                      </div>
                      <div>
                        <h3>Здесь будет ваш первый сервер</h3>
                        <p>Выберите игру — мастер проведёт через настройку.</p>
                      </div>
                      <button className="secondary" onClick={() => navigate('library')}>
                        Начать <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                  <div className="section-heading">
                    <h2>Ваша следующая сессия</h2>
                    <button className="text-button" onClick={() => navigate('library')}>
                      Вся библиотека <ArrowRight size={15} />
                    </button>
                  </div>
                  <div className="game-grid compact">
                    {games.slice(0, 4).map((g) => (
                      <GameCard
                        key={g.id}
                        game={g}
                        create={() => setWizard(g)}
                        guide={() => void run('guide', g.id)}
                      />
                    ))}
                  </div>
                  <div className="notice">
                    <ShieldCheck size={17} />
                    <span>
                      <strong>Приватность по умолчанию.</strong> Без телеметрии. Игровые ключи
                      защищены Windows. Серверы могут обращаться к сервисам своих игр.
                    </span>
                  </div>
                </>
              )}
              {page === 'library' && (
                <>
                  <div className="toolbar">
                    <label className="search">
                      <Search size={18} />
                      <input
                        placeholder="Найти игру…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <div className="filters">
                      {[
                        ['all', 'Все игры'],
                        ['early', 'Можно настроить'],
                        ['planned', 'В разработке'],
                      ].map(([id, title]) => (
                        <button
                          key={id}
                          className={filter === id ? 'selected' : ''}
                          onClick={() => setFilter(id)}
                        >
                          {title}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="notice">
                    <Activity size={17} />
                    <span>
                      BeamMP, Minecraft, Terraria, Valheim, AC, ACC и EVO настраиваются здесь.
                      Серверное ПО устанавливается отдельно по официальным лицензиям, настройки
                      остаются в GameHub.
                    </span>
                  </div>
                  <div className="game-grid">
                    {games
                      .filter(
                        (g) =>
                          (filter === 'all' || g.support === filter) &&
                          `${g.title} ${g.subtitle}`.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((g) => (
                        <GameCard
                          key={g.id}
                          game={g}
                          create={() => setWizard(g)}
                          guide={() => void run('guide', g.id)}
                        />
                      ))}
                  </div>
                </>
              )}
              {page === 'servers' && (
                <>
                  {servers.length ? (
                    <>
                      <label className="search wide">
                        <Search size={18} />
                        <input
                          placeholder="Поиск по имени или игре…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <div className="server-grid">
                        {servers
                          .filter((s) =>
                            (s.name + game(s).title).toLowerCase().includes(query.toLowerCase()),
                          )
                          .map((s) => (
                            <ServerCard
                              key={s.id}
                              server={s}
                              game={game(s)}
                              open={() => open(s)}
                              run={run}
                              busy={busy}
                            />
                          ))}
                      </div>
                    </>
                  ) : (
                    <div className="big-empty">
                      <Layers size={48} />
                      <h2>Каждая игра заслуживает своего места</h2>
                      <p>Создайте сервер, добавьте контент и пригласите друзей.</p>
                      <button className="primary" onClick={() => navigate('library')}>
                        <Plus size={17} />
                        Создать первый сервер
                      </button>
                    </div>
                  )}
                </>
              )}
              {page === 'guides' && (
                <>
                  <label className="search wide">
                    <Search size={18} />
                    <input
                      placeholder="Найти руководство…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="guide-grid">
                    {games
                      .filter((g) =>
                        (g.title + g.description).toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((g) => (
                        <div className="panel" key={g.id}>
                          <GameMark game={g} />
                          <h2>{g.title}</h2>
                          <p>{g.description}</p>
                          <ol>
                            {g.id === 'beammp' ? (
                              <>
                                <li>
                                  Установите Visual C++ Redistributable по официальной инструкции.
                                </li>
                                <li>Создайте сервер и скачайте официальный EXE.</li>
                                <li>Введите свой AuthKey и выберите карту.</li>
                                <li>Импортируйте ZIP с папками vehicles/ или levels/.</li>
                                <li>Проверьте диагностику, запустите сервер и откройте консоль.</li>
                              </>
                            ) : g.id === 'minecraft' ? (
                              <>
                                <li>Выберите ядро, версию Minecraft, сид и правила мира.</li>
                                <li>
                                  Нажмите «Установить ядро + Java» — файлы загрузятся из официальных
                                  источников.
                                </li>
                                <li>Перед загрузкой прочитайте и явно примите EULA.</li>
                                <li>
                                  При необходимости импортируйте ZIP мира с level.dat в корне.
                                </li>
                                <li>Останавливайте сервер кнопкой, чтобы сохранить мир.</li>
                              </>
                            ) : ['assetto', 'acc', 'evo'].includes(g.id) ? (
                              <>
                                <li>
                                  Создайте экземпляр и нажмите «Установить / обнаружить в Steam».
                                </li>
                                <li>Выберите трассу, автомобили или класс и настройте сессии.</li>
                                <li>
                                  Участники, BoP и редкие настройки находятся во вкладке «Все
                                  параметры».
                                </li>
                                <li>Для AC перетащите ZIP машин или трасс во вкладку контента.</li>
                                <li>
                                  Запустите сервер; при остановке GameHub отправит Windows CTRL+C.
                                </li>
                              </>
                            ) : (
                              <>
                                <li>Откройте официальное руководство.</li>
                                <li>
                                  Адаптер GameHub ещё не готов; локальный запуск из приложения
                                  недоступен.
                                </li>
                              </>
                            )}
                          </ol>
                          <button className="secondary" onClick={() => void run('guide', g.id)}>
                            Официальный источник <ExternalLink size={15} />
                          </button>
                        </div>
                      ))}
                  </div>
                </>
              )}
              {page === 'settings' && (
                <div className="settings-grid">
                  <div className="panel">
                    <FolderOpen className="violet" />
                    <h2>Хранилище серверов</h2>
                    <p>
                      Изменение применяется к новым экземплярам. Созданные серверы сохраняют свои
                      папки.
                    </p>
                    <code className="path">{stats.root}</code>
                    <button className="secondary" onClick={() => void run('setRoot')}>
                      Выбрать папку
                    </button>
                  </div>
                  <div className="panel">
                    <ShieldCheck className="violet" />
                    <h2>Личные данные</h2>
                    <p>
                      Локальная SQLite и резервные копии находятся в данных приложения Windows.
                      AuthKey хранится в защищённом хранилище; BeamMP требует открытый ключ в своём
                      TOML на диске.
                    </p>
                    <p>
                      Не публикуйте папки серверов, резервные копии и скриншоты с адресами.
                      Телеметрии, автоматических отчётов и загрузки логов нет.
                    </p>
                  </div>
                  <div className="panel">
                    <Cpu className="violet" />
                    <h2>Зависимости и ресурсы</h2>
                    <p>
                      До трёх активных серверов. Перед запуском Minecraft проверяется свободная
                      память. Подходящая Java устанавливается вместе с ядром; можно выбрать свою.
                    </p>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void run('chooseJava')}
                    >
                      Выбрать java.exe
                    </button>
                  </div>
                  <div className="panel">
                    <Gamepad2 className="violet" />
                    <h2>О проекте</h2>
                    <p>GameHub {snapshot.version} · ранняя версия.</p>
                    <p>
                      Проект «навайбкожен»: создан при значительной помощи ИИ. Это не гарантия
                      безопасности или полной игровой совместимости. Проверяйте изменения и храните
                      резервные копии.
                    </p>
                    <button className="secondary" onClick={() => void run('quit')}>
                      Закрыть приложение
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <footer>
            <span>Сделано для совместной игры.</span>
            <span>
              <span className="live-dot" /> ЛОКАЛЬНО · БЕЗ ОБЛАКА
            </span>
          </footer>
        </div>
      </main>
      {wizard && (
        <Wizard
          game={wizard}
          close={() => setWizard(undefined)}
          run={run}
          busy={busy}
          created={(s) => {
            setWizard(undefined);
            open(s);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="alert">
          <Activity size={19} />
          <span>{toast}</span>
          <button onClick={() => setToast('')} aria-label="Закрыть уведомление">
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
  note,
  percent,
  accent,
}: {
  icon: typeof Server;
  label: string;
  value: string;
  note: string;
  percent?: number;
  accent?: boolean;
}) {
  return (
    <div className={'metric ' + (accent ? 'accent' : '')}>
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      {percent !== undefined && (
        <div className="progress">
          <i style={{ width: `${percent}%` }} />
        </div>
      )}
      <small>{note}</small>
    </div>
  );
}
function GameMark({ game }: { game: Game }) {
  return (
    <div
      className="game-mark"
      style={{ color: game.color, borderColor: game.color + '33', background: game.color + '12' }}
    >
      {game.mark}
    </div>
  );
}
function GameCard({ game, create, guide }: { game: Game; create: () => void; guide: () => void }) {
  return (
    <article
      className={'game-card game-' + game.id}
      style={{ '--game-color': game.color } as React.CSSProperties}
    >
      <div className="game-cover">
        <div className="game-pattern" />
        <span className="game-genre">{game.genre}</span>
        <span className="cover-letter">{game.mark}</span>
        <div className="cover-shapes" />
        <span className="cover-caption">{game.subtitle.toUpperCase()}</span>
      </div>
      <div className="game-info">
        <div className="game-title-row">
          <h3>{game.title}</h3>
          <span className={'support-dot ' + game.support} />
        </div>
        <small>{supportLabels[game.support]}</small>
        <p>{game.description}</p>
        <button
          className={game.support === 'early' ? 'secondary' : 'text-button'}
          onClick={game.support === 'early' ? create : guide}
        >
          {game.support === 'early' ? 'Создать сервер' : 'Официальная информация'}
          {game.support === 'early' ? <Plus size={16} /> : <ExternalLink size={14} />}
        </button>
      </div>
    </article>
  );
}
type Run = <T = unknown>(action: Action, payload?: unknown) => Promise<T | undefined>;
function ServerCard({
  server: s,
  game,
  open,
  run,
  busy,
}: {
  server: ServerRecord;
  game: Game;
  open: () => void;
  run: Run;
  busy: boolean;
}) {
  const running = ['running', 'stopping'].includes(s.status);
  return (
    <article className="server-card">
      <div className="server-top">
        <GameMark game={game} />
        <button className="icon-button" onClick={open} aria-label="Открыть сервер">
          <MoreHorizontal size={20} />
        </button>
      </div>
      <button className="card-name" onClick={open}>
        {s.name}
      </button>
      <p>
        {game.title} <span>·</span> {s.players} слотов
      </p>
      <div className={'status ' + s.status}>
        <span />
        {stateLabels[s.status]}
      </div>
      <div className="server-bottom">
        <span>{s.installed ? `:${s.port}` : 'Нужна установка'}</span>
        <button
          disabled={busy || s.status === 'stopping'}
          className={running ? 'secondary small' : 'primary small'}
          onClick={() => void run(running ? 'stop' : 'start', s.id)}
        >
          {running ? <Square size={13} /> : <Play size={13} />}{' '}
          {running ? 'Остановить' : 'Запустить'}
        </button>
      </div>
    </article>
  );
}
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
function Wizard({
  game,
  close,
  run,
  busy,
  created,
}: {
  game: Game;
  close: () => void;
  run: Run;
  busy: boolean;
  created: (s: ServerRecord) => void;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('lan');
  const [input, setInput] = useState<ServerInput>(() =>
    serverInput.parse({
      game: game.id,
      name: `Мой ${game.title}`,
      port: (
        {
          beammp: 30814,
          minecraft: 25565,
          assetto: 9600,
          acc: 9231,
          evo: 9700,
          valheim: 2456,
          terraria: 7777,
          factorio: 34197,
          nightcoop: 47800,
        } as Record<string, number>
      )[game.id],
      players: game.id === 'valheim' ? 10 : ['beammp', 'nightcoop'].includes(game.id) ? 8 : 12,
    }),
  );
  const steps = ['Установка', 'Основное', 'Игра', 'Контент', 'Подключение', 'Готово'];
  const next = () => {
    const result = serverInput.safeParse(input);
    if (!result.success) {
      setError(result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('\n'));
      return;
    }
    setError('');
    setStep(step + 1);
  };
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Создать сервер">
        <div className="modal-header">
          <div>
            <span className="eyebrow">НОВАЯ ИГРОВАЯ СЕССИЯ</span>
            <h2>Создать сервер {game.title}</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <div className="steps">
          {steps.map((s, i) => (
            <div key={s} className={i <= step ? 'step reached' : 'step'}>
              <span>{i < step ? <Check size={13} /> : i + 1}</span>
              {s}
            </div>
          ))}
        </div>
        <div className="modal-body">
          {step === 0 && (
            <>
              <div className="wizard-intro">
                <GameMark game={game} />
                <h3>Сначала — собственное место для игры</h3>
                <p>
                  GameHub создаст отдельную папку для этого экземпляра. Игровые файлы в поставку не
                  входят.
                </p>
              </div>
              <div className="callout">
                <ArrowDownToLine size={22} />
                <div>
                  <strong>
                    {game.id === 'nightcoop'
                      ? 'Автоматическая сборка NightCoop Hub для Linux VPS'
                      : game.id === 'beammp'
                        ? 'Официальный BeamMP Server'
                        : game.id === 'minecraft'
                          ? 'Ядро Minecraft + подходящая Java'
                          : ['terraria', 'factorio'].includes(game.id)
                            ? 'Автоматическая загрузка официального сервера'
                            : game.id === 'valheim'
                              ? 'Автоматическая установка через SteamCMD'
                              : 'Официальный сервер Steam Tools'}
                  </strong>
                  <p>
                    {game.id === 'nightcoop'
                      ? 'GameHub загрузит закреплённые исходники NightCoop и ENet, соберёт хаб и создаст ключ. Нужны Ubuntu 24.04+ / Debian 13+ и g++ 13+. Серверный установщик ставит компилятор автоматически.'
                      : game.id === 'beammp'
                        ? 'После создания нажмите «Установить». GameHub сам скачает подходящий официальный релиз BeamMP, проверит загрузку и подготовит папки. Выбор файлов не нужен.'
                        : game.id === 'minecraft'
                          ? 'После создания нажмите «Установить ядро + Java». GameHub скачает выбранную версию из официального источника и подготовит runtime.'
                          : ['terraria', 'valheim', 'factorio'].includes(game.id)
                            ? 'После создания нажмите «Установить». GameHub загрузит официальный сервер и подготовит отдельный мир. Для Valheim SteamCMD скачивается автоматически, вход в Steam не требуется.'
                            : 'GameHub обнаружит установленный Steam Tool и скопирует его в отдельную папку экземпляра. Если его нет — откроет официальную установку Steam. Настройки редактируются внутри GameHub.'}
                  </p>
                </div>
              </div>
              <button className="text-button" onClick={() => void run('guide', game.id)}>
                Открыть официальный источник <ExternalLink size={14} />
              </button>
            </>
          )}
          {step === 1 && (
            <>
              <h3>Как назовём сервер?</h3>
              <div className="form-grid">
                <Field label="Название">
                  <input
                    autoFocus
                    value={input.name}
                    onChange={(e) => setInput({ ...input, name: e.target.value })}
                  />
                </Field>
                <Field label="Максимум игроков">
                  <input
                    type="number"
                    min={1}
                    max={128}
                    value={input.players}
                    disabled={['valheim', 'nightcoop'].includes(game.id)}
                    onChange={(e) => setInput({ ...input, players: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Порт">
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={input.port}
                    onChange={(e) => setInput({ ...input, port: Number(e.target.value) })}
                  />
                  <button
                    type="button"
                    className="secondary small"
                    onClick={async () => {
                      const port = await run<number>('freePort');
                      if (port) setInput({ ...input, port });
                    }}
                  >
                    Подобрать свободный
                  </button>
                </Field>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h3>Правила вашей игры</h3>
              <ConfigFields value={input} set={setInput} game={game} basics={false} />
            </>
          )}
          {step === 3 && (
            <>
              <Upload size={42} className="violet" />
              <h3>Свои карты, машины и миры</h3>
              <p>
                {game.id === 'beammp'
                  ? 'После создания откройте «Контент»: выберите ZIP с папками vehicles/ или levels/. GameHub проверит структуру и покажет состав архива перед установкой.'
                  : game.id === 'minecraft'
                    ? 'Перетаскивайте ZIP миров/datapacks и JAR модов прямо в окно. GameHub учитывает выбранное ядро: Paper, Fabric, Forge или NeoForge.'
                    : game.id === 'assetto'
                      ? 'Перетащите ZIP с машиной или трассой — GameHub распознает content/cars и content/tracks.'
                      : 'Официальные ACC/EVO используют собственные каталоги. Пользовательские ZIP-машины/трассы не обещаются; остальные настройки доступны в формах.'}
              </p>
              <div className="notice">
                <ShieldCheck size={20} />
                <span>
                  Импорт выполняется только на остановленном сервере и после резервного копирования.
                  Совместимость версий нужно проверить по описанию автора.
                </span>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <h3>Кто будет играть?</h3>
              <div className="connection-options">
                {[
                  ['local', 'Только этот компьютер', 'Подключение по 127.0.0.1'],
                  ['lan', 'Локальная сеть', 'Адрес компьютера в вашей сети'],
                  ['internet', 'Друзья через интернет', 'Потребуется настройка сети'],
                ].map(([id, title, desc]) => (
                  <button
                    key={id}
                    className={mode === id ? 'chosen' : ''}
                    onClick={() => setMode(id)}
                  >
                    <Network size={20} />
                    <span>
                      <strong>{title}</strong>
                      <small>{desc}</small>
                    </span>
                    {mode === id && <Check size={18} />}
                  </button>
                ))}
              </div>
              <p>
                Это подсказка по подключению, а не сетевое ограничение доступа. Для ограничения
                используйте Windows Firewall. GameHub не меняет правила автоматически.
              </p>
              {mode === 'internet' && (
                <div className="notice">
                  Проверьте проброс портов и CGNAT у провайдера. Запуск процесса не подтверждает
                  доступность из интернета.
                </div>
              )}
            </>
          )}
          {step === 5 && (
            <>
              <div className="wizard-intro">
                <ShieldCheck size={42} className="violet" />
                <h3>Всё начинается здесь.</h3>
                <p>
                  Будет создана настоящая конфигурация. Установку, диагностику и запуск вы выполните
                  в карточке сервера.
                </p>
              </div>
              <div className="summary-row">
                <span>Сервер</span>
                <strong>{input.name}</strong>
              </div>
              <div className="summary-row">
                <span>Игра</span>
                <strong>{game.title}</strong>
              </div>
              <div className="summary-row">
                <span>Игроки / порт</span>
                <strong>
                  {input.players} / {input.port}
                </strong>
              </div>
              <div className="summary-row">
                <span>Подключение</span>
                <strong>
                  {mode === 'internet'
                    ? 'Интернет: требует настройки'
                    : mode === 'local'
                      ? 'Этот компьютер'
                      : 'Локальная сеть'}
                </strong>
              </div>
            </>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="modal-footer">
          <button className="text-button" onClick={() => (step ? setStep(step - 1) : close())}>
            <ArrowLeft size={16} />
            {step ? 'Назад' : 'Отмена'}
          </button>
          <span>Шаг {step + 1} из 6</span>
          {step < 5 ? (
            <button className="primary" onClick={next}>
              Продолжить <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                const s = await run<ServerRecord>('create', input);
                if (s) created(s);
              }}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Создать
              сервер
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
function Details({
  server: s,
  game,
  run,
  busy,
  stats,
  back,
  notify,
}: {
  server: ServerRecord;
  game: Game;
  run: Run;
  busy: boolean;
  stats: Snapshot['stats'];
  back: () => void;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState('overview');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [content, setContent] = useState<Content[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [checks, setChecks] = useState<Diagnostic[]>([]);
  const [command, setCommand] = useState('');
  const toInput = (s: ServerRecord) =>
    serverInput.parse(
      Object.fromEntries(
        Object.keys(serverInput.shape).map((k) => [k, k === 'authKey' ? '' : (s as any)[k]]),
      ),
    );
  const [form, setForm] = useState<ServerInput>(() => toInput(s));
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setForm(toInput(s));
  }, [s.id]);
  const reload = async () => {
    try {
      if (tab === 'console') setLogs(await api!.call('logs', s.id));
      if (tab === 'content') setContent(await api!.call('content', s.id));
      if (tab === 'backups') setBackups(await api!.call('backups', s.id));
    } catch (e) {
      notify((e as Error).message);
    }
  };
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 1500);
    return () => clearInterval(t);
  }, [tab, s.id]);
  const mutate = async (action: Action, payload?: unknown) => {
    await run(action, payload ?? s.id);
    await reload();
  };
  const running = ['running', 'stopping'].includes(s.status);
  return (
    <>
      <button className="text-button back" onClick={back}>
        <ArrowLeft size={15} />К моим серверам
      </button>
      <div className="detail-heading">
        <GameMark game={game} />
        <div>
          <span className="eyebrow">{game.title.toUpperCase()}</span>
          <h1>{s.name}</h1>
          <span className={'status ' + s.status}>
            <span />
            {stateLabels[s.status]}
          </span>
        </div>
        <div className="detail-actions">
          <button className="secondary" onClick={() => void run('openFolder', s.id)}>
            <FolderOpen size={17} />
            Файлы
          </button>
          <button
            disabled={busy || s.status === 'stopping'}
            className={running ? 'secondary' : 'primary'}
            onClick={() => void mutate(running ? 'stop' : 'start')}
          >
            {running ? <Square size={15} /> : <Play size={15} />}{' '}
            {running ? 'Остановить' : 'Запустить'}
          </button>
        </div>
      </div>
      {s.lastError && <div className="notice error">{s.lastError}</div>}
      <div className="tabs">
        {[
          ['overview', 'Обзор'],
          ['settings', 'Настройки'],
          ['console', 'Консоль'],
          ['content', 'Контент и миры'],
          ['backups', 'Резервные копии'],
          ['network', 'Подключение'],
          ['diagnostics', 'Диагностика'],
          ['advanced', 'Все параметры'],
          ...(s.game === 'minecraft' ? [['players', 'Игроки']] : []),
          ...(s.game === 'nightcoop' ? [['nightcoop', 'NightCoop']] : []),
        ].map(([id, title]) => (
          <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>
            {title}
          </button>
        ))}
      </div>
      {tab === 'overview' && (
        <>
          <div className="stats-grid">
            <Metric
              icon={Activity}
              label="Состояние процесса"
              value={running ? 'Запущен' : 'Остановлен'}
              note={s.pid ? `PID ${s.pid}` : 'Процесс не работает'}
              accent
            />
            <Metric
              icon={Cpu}
              label="CPU процесса"
              value={s.cpu === undefined ? '—' : s.cpu + '%'}
              note="По данным системы"
            />
            <Metric
              icon={MemoryStick}
              label="Память процесса"
              value={s.memoryMB === undefined ? '—' : `${s.memoryMB} МБ`}
              note="Фактическое потребление"
            />
            <Metric
              icon={Network}
              label="Игровой порт"
              value={String(s.port)}
              note={
                s.game === 'nightcoop'
                  ? 'UDP · все порты во вкладке NightCoop'
                  : s.game !== 'minecraft'
                    ? 'TCP + UDP'
                    : 'TCP'
              }
            />
          </div>
          <div className="settings-grid">
            <div className="panel">
              <h2>Подготовка к запуску</h2>
              {s.installation && (
                <div className="installation-status">
                  <strong>{s.installation.phase}</strong>
                  {s.installation.total && (
                    <progress value={s.installation.bytes ?? 0} max={s.installation.total} />
                  )}
                  <small>
                    {s.installation.bytes
                      ? Math.round(s.installation.bytes / 1024 ** 2) + ' МБ'
                      : ''}{' '}
                    {s.installation.error ?? ''}
                  </small>
                  {busy && s.game === 'minecraft' && (
                    <button
                      className="secondary small"
                      onClick={() => void api!.call('cancelInstall', s.id)}
                    >
                      Отменить загрузку
                    </button>
                  )}
                </div>
              )}
              <ol>
                <li>Установите или импортируйте серверное ПО.</li>
                <li>
                  {s.game === 'nightcoop'
                    ? 'Укажите внешний адрес VPS и откройте UDP-порты из вкладки NightCoop.'
                    : s.game === 'beammp'
                      ? 'Заполните AuthKey в настройках.'
                      : s.game === 'minecraft'
                        ? 'Выберите версию ядра, примите EULA и нажмите «Установить».'
                        : 'Выберите трассу, машины и сессии в настройках.'}
                </li>
                <li>Запустите диагностику и исправьте предупреждения.</li>
                <li>Запустите сервер. Проверьте готовность в его консоли.</li>
              </ol>
              <div className="button-row">
                <button
                  disabled={busy || running}
                  className="primary"
                  onClick={() => void mutate('install')}
                >
                  <ArrowDownToLine size={16} />
                  {s.game === 'nightcoop'
                    ? 'Установить NightCoop автоматически'
                    : s.game === 'beammp'
                      ? 'Установить BeamMP'
                      : s.game === 'minecraft'
                        ? 'Установить ядро + Java'
                        : ['terraria', 'valheim', 'factorio'].includes(s.game)
                          ? 'Установить сервер автоматически'
                          : 'Установить / обнаружить в Steam'}
                </button>
                {s.game === 'beammp' && (
                  <button
                    disabled={busy || running}
                    className="secondary"
                    onClick={() => void mutate('importBinary')}
                  >
                    Импорт EXE
                  </button>
                )}
              </div>
              {s.game === 'minecraft' && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run('chooseJava', s.id)}
                >
                  Выбрать java.exe
                </button>
              )}
            </div>
            <div className="panel">
              <ShieldCheck className="violet" />
              <h2>Данные под контролем</h2>
              <p>
                Перед изменением настроек, контента и мира создаётся резервная копия. Для
                целостности сервер должен быть остановлен.
              </p>
              <p>
                Статус «Процесс запущен» означает, что существует процесс, а не что друзья уже могут
                подключиться. Игровые клиенты в этой среде не тестировались.
              </p>
              <button className="text-button" onClick={() => void run('guide', game.id)}>
                Руководство игры <ExternalLink size={14} />
              </button>
            </div>
          </div>
        </>
      )}
      {tab === 'advanced' && (
        <ConfigEditor
          server={s}
          notify={notify}
          busy={busy}
          save={(name, data) => run('saveConfigDocument', { id: s.id, name, data })}
        />
      )}
      {tab === 'players' && <PlayersPanel server={s} busy={busy} run={run} />}
      {tab === 'nightcoop' && <NightcoopPanel server={s} notify={notify} />}
      {tab === 'settings' && (
        <div className="panel">
          <div className="section-heading">
            <h2>Игровые параметры</h2>
            <span className="pill">Нужен перезапуск</span>
          </div>
          <ConfigFields
            value={form}
            set={(v) => {
              setSaved(false);
              setForm(v);
            }}
            game={game}
            serverId={s.id}
          />
          <p>
            Неизвестные поля конфигурации сохраняются. TOML форматируется заново. Перед сохранением
            создаётся копия. Сервер должен быть остановлен.
          </p>
          <div className="button-row">
            <button
              disabled={busy || running}
              className="primary"
              onClick={async () => {
                const result = await run<ServerRecord>('update', { id: s.id, input: form });
                if (result) {
                  setForm(toInput(result));
                  setSaved(true);
                }
              }}
            >
              <Check size={16} />
              Сохранить
            </button>
            <button
              className="secondary"
              onClick={() => {
                setForm(toInput(s));
                setSaved(false);
              }}
            >
              Отменить изменения
            </button>
            {saved && <span className="success">Сохранено</span>}
          </div>
        </div>
      )}
      {tab === 'console' && (
        <div className="console">
          <div className="console-header">
            <span>
              <Terminal size={16} />
              Живая консоль
            </span>
            <small>Последние 600 строк · личные пути, IP и известные ключи скрываются</small>
          </div>
          <div className="console-lines">
            {logs.length ? (
              logs.map((l, i) => (
                <div key={i} className={l.stream}>
                  <time>{time(l.time)}</time>
                  <span>{l.text}</span>
                </div>
              ))
            ) : (
              <p>Здесь появится реальный вывод серверного процесса после запуска.</p>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate('command', { id: s.id, command });
              setCommand('');
            }}
          >
            <span>›</span>
            <input
              aria-label="Команда сервера"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Введите команду…"
              maxLength={400}
              disabled={!running || s.status === 'stopping'}
            />
            <button className="primary small" disabled={busy || !running || !command}>
              Отправить
            </button>
          </form>
        </div>
      )}
      {tab === 'content' && <ContentPanel server={s} busy={busy} run={run} notify={notify} />}
      {tab === 'backups' && (
        <div className="panel">
          <div className="section-heading">
            <h2>Резервные копии</h2>
            <button
              className="primary"
              disabled={busy || running}
              onClick={() => void mutate('backup')}
            >
              <Database size={16} />
              Создать копию
            </button>
          </div>
          <p>
            Копии создаются после остановки сервера. Ядро сервера, EXE, DLL, официальные пакеты и
            кеши исключены; пользовательские моды JAR сохраняются. Из известных конфигураций секреты
            очищаются и восстанавливаются из защищённого хранилища. Копии могут содержать данные
            игроков и пароли из пользовательских файлов.
          </p>
          {backups.length ? (
            <div className="file-list">
              {backups.map((b) => (
                <div key={b.id}>
                  <Database size={18} />
                  <strong>{new Date(b.createdAt).toLocaleString('ru-RU')}</strong>
                  <span>{size(b.bytes)}</span>
                  <button
                    className="secondary small"
                    disabled={busy || running}
                    onClick={() => void mutate('restore', { id: s.id, backupId: b.id })}
                  >
                    Восстановить
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="small-empty">
              <Database size={30} />
              <p>Копий пока нет</p>
            </div>
          )}
          <small>
            Перед восстановлением проверяется SHA-256. Предыдущая папка сохраняется рядом; место на
            диске не очищается автоматически.
          </small>
        </div>
      )}
      {tab === 'network' && s.game === 'nightcoop' && <NightcoopPanel server={s} notify={notify} />}
      {tab === 'network' && s.game !== 'nightcoop' && (
        <div className="settings-grid">
          <div className="panel">
            <Network className="violet" />
            <h2>Адрес для подключения</h2>
            <p>
              Этот компьютер: <code>127.0.0.1:{s.port}</code>
            </p>
            {stats.addresses.map((a) => (
              <div className="address" key={a}>
                <code>
                  {a}:{s.port}
                </code>
                <button
                  className="icon-button"
                  aria-label="Скопировать адрес"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(`${a}:${s.port}`)
                      .then(() => notify('Адрес скопирован'))
                      .catch(() => notify('Не удалось скопировать адрес'));
                  }}
                >
                  <Copy size={16} />
                </button>
              </div>
            ))}
            <p>Это локальные адреса. Они не подтверждают доступность сервера из интернета.</p>
          </div>
          <div className="panel">
            <Globe className="violet" />
            <h2>Пригласить друзей</h2>
            <ol>
              <li>Разрешите игровые порты в firewall компьютера или VPS.</li>
              <li>
                Для интернета настройте проброс {s.game === 'beammp' ? 'TCP и UDP' : 'TCP'} порта{' '}
                {s.port} на маршрутизаторе.
              </li>
              <li>Если используется CGNAT, уточните у провайдера возможность публичного адреса.</li>
              <li>
                Проверяйте подключение с внешней сети. GameHub не сканирует интернет и не узнаёт ваш
                публичный IP.
              </li>
            </ol>
            <p>
              Веб-панель использует собственный HTTPS-порт, отдельный от игровых портов.
              Автоматическая настройка Firewall недоступна.
            </p>
          </div>
        </div>
      )}
      {tab === 'diagnostics' && (
        <div className="panel">
          <div className="section-heading">
            <h2>Почему не работает?</h2>
            <button
              disabled={busy}
              className="primary"
              onClick={async () => {
                const result = await run<Diagnostic[]>('diagnose', s.id);
                if (result) setChecks(result);
              }}
            >
              <Activity size={16} />
              Проверить
            </button>
          </div>
          <p>
            Проверка файлов, зависимостей и локальных портов. Доступность из интернета, firewall и
            правильность версии ядра автоматически не подтверждаются.
          </p>
          {checks.map((c) => (
            <div className="check-row" key={c.label}>
              <span className={c.ok ? 'check-ok' : 'check-fail'}>
                {c.ok ? <Check size={18} /> : <X size={18} />}
              </span>
              <div>
                <strong>{c.label}</strong>
                <p>{c.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
