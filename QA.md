# Release validation

Version 0.4.0 is checked with TypeScript validation, parser/database/renderer regressions, production dependency auditing, Windows packaging, a packaged-content privacy audit, and native startup and real-ingestion smoke checks.

Startup smoke uses a fresh temporary profile and verifies empty records/sources/Radars, onboarding, rejection of legacy demo mode, sandbox/context isolation, and no renderer errors. Real-ingestion smoke uses a separate temporary profile and public requests to check search/Radars, maps, published image loading/fallback, settings, tutorial, and resets. Temporary profiles, screenshots, and reports are ignored local artifacts, not release assets.

Test inputs are synthetic regression cases or attributed public parser samples; runtime code never loads them. Package auditing rejects private files, source maps, sample payloads, and personal build paths and creates SHA-256 checksums for both executables.

Coverage changes between runs as publishers and services change. HTTP failures are recorded without fabricated replacements. Bluesky returned HTTP 403 during prior real validation. Packages remain unsigned; code signing is outstanding.
