# Архитектура

```text
React → sandboxed preload → validated IPC → Electron main
                                          ├─ Manager → adapters → configs
                                          ├─ Store → SQLite (sql.js)
                                          ├─ archives → bounded ZIP backup/restore
                                          └─ per-server supervisor → process
```

`shared/` — контракты и каталог, `src/` — UI, `electron/main.ts` — граница доверия и очередь изменений. Чтение состояния не блокируется загрузкой/остановкой. `manager.ts` — экземпляры и процессы, `adapters.ts` — реальные конфигурации BeamMP и Minecraft. Секрет не передаётся обратно в UI.

SQLite хранится вне checkout; sql.js устраняет native ABI-сборку SQLite. Небольшая база сохраняется атомарной заменой файла. Экземпляры получают UUID-папки и уникальные порты, до трёх активных процессов.

Supervisor запускается Electron в Node-режиме и общается с main по приватному IPC, передаёт stdout/stderr. Команды остановки — exit / stop; main ждёт закрытия процесса. Disconnect запрашивает штатную остановку. Журнал PID служит диагностике, не автоматическому kill/attach.

Для новой игры нужны собственные конфигурации, подтверждённый запуск/остановка, контент, сохранения и тесты. EVO не использует INI оригинальной AC. Valheim требует Windows helper с CTRL+C: ChildProcess.kill() не принимается за безопасное сохранение.

Перед расширением каталога Manager нужно разделить на ProcessService, BackupService, ContentService и AdapterRegistry.
