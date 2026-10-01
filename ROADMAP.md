# What's Up — roadmap

## Implemented in 0.2.0

The existing desktop design is now connected to a real public-data engine: arbitrary city lookup, persistent regional source discovery, conditional HTTP, RSS/Atom, JSON-LD, ICS, JSON and conservative HTML extraction; normalized SQLite records; honest dates/coordinates; geocoding; deduplication with supporting links; deterministic semantic search; structured Radars; adaptive scheduling; bounded browser fallback; actual maps/charts/reports/provenance and diagnostics.

Real mode is default. Developer fixtures remain isolated and explicitly labeled. SQLite v1 upgrades preserve user data.

## Further coverage and release work

- Additional public discovery providers and region-specific 511, transportation, incident, utility and weather adapters.
- Broader calendar/provider compatibility and low-resource performance measurement.
- Optional local embeddings and optional source integrations; base operation remains independent of paid keys.
- Advanced map clustering and richer exports.
- Signed Windows releases, update policy, broader accessibility audit and Linux/macOS verification.

No exhaustive local coverage is claimed. See QA.md for actual validation and current limits.
