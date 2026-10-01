# Changelog

## 0.4.2

- Full Refresh is the default manual scan; empty workspaces retry discovery with Smart Scan.
- Address and venue selections use their surrounding city for discovery without changing map coordinates or saved workspace keys. City time zones are resolved when available.
- Provider outages stop repeated queries; Full Refresh retries cached failures while publisher collection continues.
- Empty Quick Scan reports no source checks were due; Clear filters includes all collected records.

## 0.4.1

- General interest categories and neutral search examples replace niche suggestions. No interests are preselected.
- Setup starts with a blank location field, without preset city suggestions, and requires a resolved place before opening the workspace. Users choose their own radius and interests.
- The installer creates a clearly named Start-menu uninstaller shortcut. Uninstall removes the application and shortcuts while retaining saved workspace data; Reset workspace explicitly clears that data.

## 0.4.0

- Public Windows x64 installer and portable release: MIT license, setup/privacy documentation, dependency notices, checksums, and Windows CI.
- Real-only startup: removed developer demo mode, sample assets, fabricated map features, and fixed sample time/location. Upgrades discard obsolete demo records while preserving real data.
- Public research, persistent intelligence views, topic Radars, scan progress/history, saved watch areas, tutorial, and workspace controls.
- Published event images with category placeholders when images are unavailable.
- Packaged-content privacy audit; tests and source maps are excluded from downloads.

Limitations: builds are unsigned. Public coverage varies and blocked sources are skipped. Scheduled scans require the app to remain open.
