# Privacy

What's Up has no accounts, app telemetry, advertising, or analytics backend. Release downloads contain code, icons, licenses, and production dependencies, without the developer's database, profile, preferences, history, credentials, logs, or demonstration records.

## Local storage

SQLite stores selected/saved areas, settings, collected records, source catalogs, Radars, saved items, search history, scan history, feedback, and geocoding caches under your Windows user profile. Older areas can remain cached. Electron also keeps application cache files. Portable builds use this same local profile storage.

Extraction caches hold at most 100 documents / 20 MB, with a 2 MB per-entry limit and expiry metadata. They contain extracted metadata and short excerpts rather than complete article bodies. Images are cached in memory up to 48 images / 24 MB. Local diagnostic JSONL is capped at 2 MB and is not automatically uploaded.

Reset workspace clears stored app preferences, records, and caches. Reset setup repeats onboarding while retaining collected data. Upgrades remove obsolete demonstration records while preserving real records and user choices.

## Network requests

- Place lookup sends location text to Open-Meteo/GeoNames; venue/address lookup uses Photon/OpenStreetMap.
- Discovery sends area or research queries to Wikimedia, Mwmbl, and optional configured SearXNG. Public Bluesky discovery may be attempted.
- Collection contacts public publishers, their feeds/calendars, and available image hosts. US weather collection uses NWS.
- OpenStreetMap tiles reveal the viewed map area.
- Original links and explicit browser searches use your browser and the destination site's own policies.

Providers receive standard network metadata, including your IP address. A bounded sandboxed browser may render accessible JavaScript pages; those sites can contact their own providers. The app does not sign you into publisher accounts or bypass authentication or access restrictions.

Package audits cover accidentally bundled private data, not information you later collect or share. Public publishers may publish names and contact information; original attribution is preserved. Review exports, screenshots, and logs before sharing them.
