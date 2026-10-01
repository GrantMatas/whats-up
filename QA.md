# Release validation

Version 0.4.0 passed TypeScript validation and all 81 regression tests. The production dependency audit reported no known vulnerabilities. The packaged-content audit rejects private files, source maps, sample payloads, and workstation paths and creates SHA-256 checksums for both executables.

Native startup smoke verified empty records/sources/Radars, unset location/interests, onboarding, rejection of legacy demo mode, sandbox/context isolation, and zero renderer errors.

An isolated real-source scan collected 13 actual records from 176 discovered sources, with 10 mapped records and 12 records containing publisher image URLs. Native UI validation used a copy of that same freshly collected profile and passed search/Radar, maps, published image loading/fallback, settings, tutorial, feedback, saved watch areas, and both reset controls with zero renderer errors. Test-only background throttling is disabled to keep UI validation responsive when the test window is obscured. These counts describe this run, not total local coverage.

Temporary profiles, screenshots, and reports are ignored local artifacts and are not release assets. Unit inputs are synthetic regression cases or attributed public parser samples; runtime code never loads them. Windows CI runs fresh dependency installation, tests, audit, packaging, content auditing, and empty-startup smoke without release-publishing permissions.

Coverage varies as publishers and services change. HTTP failures are recorded without fabricated replacements. Bluesky returned HTTP 403 during prior validation. Packages remain unsigned; code signing is outstanding.
