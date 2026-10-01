# What's Up — architecture

## Runtime

Electron 41, React/TypeScript/Vite, existing token-based CSS, MapLibre 6, Zod and Node SQLite. Packaged assets run at the custom local `whatsup://app/` origin. No external database, account or paid API is required.

## Process boundaries

- `src/main`: window and protocol lifecycle, validated named IPC, worker orchestration, power-state signals and optional isolated browser rendering.
- `src/preload`: typed capabilities and state-change subscriptions; no generic filesystem or arbitrary IPC access.
- `src/backend/worker.ts`: discovery, bounded queue, fetching, extraction, normalization, geography, deduplication, ranking, persistence and diagnostics. Network work stays off the renderer/main UI thread.
- `src/backend/discovery`: replaceable public provider and verified regional directory extraction. Reuses persistent sources between launches.
- `collectors`, `parsers`, `extraction`, `normalization`, `geocoding`, `deduplication`, `ranking`, `search`, `radar`, `scheduler`: separately testable pipeline stages. RSS/Atom, JSON-LD, ICS recurrence, JSON/GeoJSON and static HTML preserve unknown values.
- `src/backend/database`: versioned SQLite migration, WAL, indexed records, FTS5, bounded extraction caches, jobs, source checks, geocode cache and persistent Radar matches.
- `src/shared`: models/defaults; synthetic inputs exist only in excluded regression tests.
- `src/renderer`: editorial views with shared filtering, maps, calendars, charts, reports, evidence and source diagnostics. Remote HTML is never rendered as app content.
- `src/backend/research` and `database/intelligence.ts`: bounded verification, confidence factors, original evidence, recorded changes, relationships, coverage, daily observations and saved watch areas.
- `src/backend/media.ts`: a separate two-job public image queue with supported MIME validation and bounded caching; the local protocol permits only selected-area image URLs already stored on records.

## Scheduling and access

Three global jobs and one per domain; minimum host request spacing; 15-second HTTP timeouts; bounded redirects and response sizes; one transient retry. Conditional requests use ETag and Last-Modified. Failed sources back off exponentially; unchanged sources reduce check frequency. Weather checks default to 10 minutes, feeds 30 minutes, calendars six hours and static pages 12 hours. The minute scheduler checks due sources while the app is running; this is not an OS background service.

Smart selects Quick, Deep or Full refresh from separate research/catalog cadences (default 24 / 72 hours). The daily scheduler catches up when the application opens; frequent Quick checks do not postpone research. Independent bounded lanes cover fetching, search, verification, browser rendering, geocoding and images. Battery mode reduces budgets and disables expensive rendering. Rendering is capped at two pages per scan, with memory/load checks, ephemeral storage and an independent sandbox. Restricted pages, robots prohibitions and challenges are failures, not bypass targets. Documented application APIs are used according to their published API permission rather than search-indexing rules.

## Data contracts

Only real records are accepted; selected-area scopes stay separate. Each real record retains source/original HTTPS URLs, source classification, discovered/published/verified times, confidence, short excerpts and available metadata. Null coordinates are omitted from pins; approximate geocoding stays labeled. Point, LineString and Polygon use actual source geometry. Weather severity/certainty/urgency and affected-area metadata are retained. No arbitrary polygon or event time is generated.

Deduplication conservatively combines title/date/place/coordinates or common original URLs. It preserves supporting links and saved IDs, removes superseded rows/FTS entries and reevaluates Radars. Confirmation is never inferred from a publisher's single claim. FTS5 BM25 candidates are combined with deterministic topic synonyms, category/genre metadata, exclusions, local-time filters and distance. Structured Radar preferences and reasons are stored locally.

## Isolation and privacy

Sandbox/context isolation/web security are enabled; renderer Node integration, permissions, popups and navigation are disabled. IPC validates both sender and Zod payloads. Collector URLs require public HTTPS and reject private/reserved DNS results. Browser fallback validates each request and has no Node/preload bridge. Source content is converted to plain text; short news excerpts and metadata are cached, not article bodies.

Location/query text leaves the device for public services, and visible map coordinates reach OpenStreetMap. SQLite contains the current selection plus previous scoped content caches. Reset explicitly deletes local data; migrations never wipe user data as a normal upgrade step.

## Build and QA

Vite bundles the renderer and a dedicated MapLibre worker at the secure local origin. esbuild bundles main, preload and ingestion worker without source maps or sample assets. Electron builder emits Windows NSIS/portable packages. Automated tests cover extraction, unknown data, scope/mode separation, migration, deduplication, time zones/DST, geocoding, search/Radars, robots and scheduling. Native real-ingestion and empty-startup smoke tests capture screenshots and check renderer errors, SQLite and bridge isolation. See QA.md for verified results and limits.
