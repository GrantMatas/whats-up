# What's Up

A local-first Windows app for discovering public events, news, alerts, and community activity around a place you choose.

## Download and launch

Download the Windows x64 build from [GitHub Releases](https://github.com/GrantMatas/whats-up/releases/latest):

- **Whats-Up-Setup-0.4.1.exe** installs the app and creates shortcuts.
- **Whats-Up-0.4.1.exe** runs without installation. Settings and collected information still live in your Windows user profile.
- **SHA256SUMS.txt** contains checksums for both downloads.

Use Windows 11 x64. No Node.js installation, account, database server, or API key is required. These builds are unsigned; Windows may show an unknown-publisher warning. Verify the release origin and checksum before deciding whether to run it. Code signing remains outstanding.

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath ".\Whats-Up-Setup-0.4.1.exe"
```

On first launch, the place field is blank. Enter and resolve your own city with its state or country, choose a radius and interests, and open your brief. Interest categories are general, with nothing preselected; you can add your own topics. New installations contain **no events, sources, saved searches, or demo data**. Public discovery fills the workspace; Sources shows progress and failures. Internet access is needed for discovery, updates, geocoding, maps, and images. Previously collected text remains available locally.

## Features

- Feed, timeline, calendar, map, heatmap, changes, topics, collections, relationship graph, and reports.
- Local search, public research, and persistent topic Radars with match explanations.
- Publisher links, dates, confidence factors, available geography, cancellations, and change history.
- Published event images with category placeholders for missing or inaccessible images.
- Quick, Smart, Deep, and Full scans with progress/history; daily schedules and catch-up while the app is open.
- Light/dark themes, saved watch areas, source preferences, Ctrl+K search, and a replayable tutorial.

Missing dates and coordinates stay unknown. Approximate venue locations are labeled. Counts and Local Pulse describe collected information, not complete coverage. Historical comparisons require sufficient observations. Closing the app stops scheduled work.

## Privacy and sources

Settings, records, Radars, saved items, and search history stay in local SQLite, normally at `%APPDATA%\What's Up\whats-up.sqlite`. There is no account, advertising, or app telemetry service. Reset workspace deletes local app data; Reset setup preserves collected information. Downloads contain code and dependencies without a user database, developer profile, logs, or sample records. See [PRIVACY.md](PRIVACY.md).

Discovery uses Wikimedia and Mwmbl; optional SearXNG can supplement it. Geocoding uses Open-Meteo/GeoNames and Photon/OpenStreetMap. Maps use OpenStreetMap tiles. US weather alerts use NWS. Public feeds, calendars, structured pages, and accessible webpages retain publisher attribution. Public Bluesky requests may be blocked or unavailable. Browser searches for Google, Bing, and Brave are explicit actions.

Location and search text reach the services used for those lookups; map tiles reveal the viewed area, and publishers see requests to pages and images. Requests respect access restrictions and applicable robots rules. Unavailable sources are recorded and skipped. Traffic and emergency coverage is incomplete; do not rely on this app for emergency decisions.

Attribution: [OpenStreetMap](https://www.openstreetmap.org/copyright), [GeoNames/Open-Meteo](https://open-meteo.com/en/docs/geocoding-api), [Photon](https://github.com/komoot/photon), [Wikimedia](https://www.mediawiki.org/wiki/API:REST_API), and [NWS](https://www.weather.gov/documentation/services-web-api). Publisher content and images retain their original rights.

## Build from source

Use Node.js 24 and npm on Windows x64:

```powershell
npm ci
npm run dev
```

Validate and package:

```powershell
npm run typecheck
npm test
npm audit --omit=dev
npm run package
npm run audit:release
node scripts/smoke.mjs "release/What's Up 0.4.1.exe"
```

`npm run build` creates the production app; `npm start` launches it. Packaging creates installer and portable executables in `release/`. Production uses the local `whatsup://app/` origin and a sandboxed renderer. The Vite browser preview starts empty and cannot run desktop ingestion.

Regression inputs under `tests/` are test-only and never bundled. Release auditing rejects sample payloads, source maps, databases, profiles, secrets, and personal build paths in application files and writes checksums. Windows CI validates and packages the source. See [QA.md](QA.md), [ARCHITECTURE.md](ARCHITECTURE.md), [MIGRATION.md](MIGRATION.md), and [CHANGELOG.md](CHANGELOG.md).

## License and support

Application code uses the [MIT License](LICENSE). Bundled dependency notices are included. The app license does not grant rights to republish publisher material. Report reproducible issues through [GitHub Issues](https://github.com/GrantMatas/whats-up/issues); remove personal information from screenshots and logs before sharing them.
