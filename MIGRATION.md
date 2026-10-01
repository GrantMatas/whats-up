# Database upgrades

Version 4 migrations run on startup and upgrade profiles to real-only operation. They retain real records, settings, saved items, and Radars, disable the legacy demo setting, and delete explicitly marked demo records/sources, their search entries, orphaned source checks, and old fixture documents.

New profiles start empty. Runtime code has no fixture loader, demo toggle, fabricated map geometry, or fixed sample clock. Synthetic regression inputs are confined to tests and excluded from downloads.

Earlier upgrades added source-area provenance and persistent research/intelligence tables. Normal upgrades preserve real user data. Reset workspace is the explicit destructive reset in Settings.
