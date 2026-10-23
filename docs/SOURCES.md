# Официальные источники

Проверено 22 октября 2026. При расширении адаптеров нужно перепроверять текущую документацию.

- [BeamMP установка](https://docs.beammp.com/server/create-a-server/) — Windows EXE, runtime, AuthKey.
- [BeamMP параметры](https://docs.beammp.com/server/server-maintenance/) — General, порты и контент.
- [BeamMP исходники и релизы](https://github.com/BeamMP/BeamMP-Server).
- [Minecraft server](https://www.minecraft.net/en-us/download/server) — официальный JAR и nogui.
- [Minecraft EULA](https://www.minecraft.net/eula) — принимается пользователем самостоятельно.
- [Paper getting started](https://docs.papermc.io/paper/getting-started/) — требования Java и запуск.
- [Valheim dedicated servers](https://www.valheimgame.com/support/a-guide-to-dedicated-servers/) — Steam, миры, CTRL+C, порты и Crossplay.
- [EVO Dedicated Server](https://support.505games.com/support/solutions/articles/150000225040-assetto-corsa-evo-dedicated-server-setup) — официальный отдельный Steam Tool.
- [AssettoServer](https://assettoserver.org/docs/next/intro/) — отличия от штатного AC.
- [Le Mans Ultimate](https://guide.lemansultimate.com/hc/en-gb) — официальная справка о Hosted Servers.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) — isolation, sandbox, preload.

В 0.2 форматы сверены с установленными Steam Tools: cfg/server_cfg.ini и entry_list.ini оригинальной AC, ServerAdminHandbook.pdf и cfg/current у ACC, cars.json, events_*.json, справка CLI и поля официального ServerLauncher у EVO. Форматы трёх игр независимы. Реальные серверы проверены на запуск, TCP-порты и CTRL+C.

Установка Minecraft использует собственные первичные сервисы поставщиков:

- [Каталог Mojang](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json).
- [Paper Downloads Service](https://docs.papermc.io/misc/downloads-service/).
- [Fabric Meta](https://meta.fabricmc.net/).
- [Forge Maven](https://maven.minecraftforge.net/).
- [NeoForge Maven](https://maven.neoforged.net/).
- [Adoptium API](https://api.adoptium.net/).

Протокол сжатых параметров EVO дополнительно сверен с первичным инженерным примером [evo-server-launcher](https://github.com/plrmntonio/evo-server-launcher), затем проверен на официальном EXE. Исходный код стороннего лаунчера в GameHub не включён.

- Terraria Dedicated Server: https://terraria.org/api/get/dedicated-servers-names и официальный загрузчик terraria.org/api/download/pc-dedicated-server/.
- Terraria console/config: https://terraria.wiki.gg/wiki/Server .
- Valheim server guide: https://www.valheimgame.com/support/a-guide-to-dedicated-servers/ .
- Factorio dedicated/headless: https://wiki.factorio.com/Multiplayer#Dedicated/Headless_server и официальный factorio.com/get-download/stable/headless/linux64. Конфигурация дополняется шаблоном установленной версии.
- Node runtime: https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt .

## NightCoop Hub

- [Официальный репозиторий](https://github.com/Twenfys/nightcoop-hub), [инструкция Linux/Docker на русском](https://github.com/Twenfys/nightcoop-hub/blob/6b694a6c86fd7c2b93743497ab3bd924553f25b8/tools/hub/docker/README.ru.md).
- Закреплённые исходники: `6b694a6c86fd7c2b93743497ab3bd924553f25b8`; ENet `5a9c537fd464b3c6d3c55e1d3bd47588faf71b42`. Команды и диапазоны сверены с `tools/hub/main.cpp`, формула UDP-портов — с `src/HubRules.hpp`.
- GameHub не включает исходники или бинарник NightCoop в свой выпуск: они загружаются на ваш сервер при явной установке. Клиентский мод устанавливается отдельно.
