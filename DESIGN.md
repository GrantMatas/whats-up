# What's Up — visual system

## Product direction
A local field guide, not a wall of dashboard widgets. The first screen should answer: what matters, what fits my interests, and where is it? A warm editorial canvas meets precise mapping tools. Product name: What's Up. Signature accent: oxidized orange.

## Reference study — September 29, 2026
Visited live in the browser before implementation:
- https://tailscale.com/: warm neutral surfaces, confident sans typography, technical labels, generous spacing, and restrained colored product tabs. Borrow clarity and approachable precision; do not reproduce its layouts.
- https://openai.com/codex/: large succinct headings, uncluttered primary actions, deliberate separation of product sections. Borrow hierarchy and calm presentation; omit decorative gradients.
- https://chatgpt.com/: narrow icon navigation, low visual noise, one strong interaction focus, subdued dark surfaces. Borrow restraint and progressive disclosure.
The browser's narrow reference viewport also shows how navigation collapses and actions wrap without losing hierarchy. Our desktop composition uses a persistent sidebar; at narrow widths it becomes an icon rail.

## Composition
Persistent 216px charcoal sidebar. Main canvas has 32–40px margins and a 1240px comfortable content width. Location and time sit above an editorial greeting. One primary map/briefing split, then ranked discoveries and a modest activity chart. Cards are for grouped content, not every line of text. Hairline dividers organize lists. All counts derive from the active dataset.

## Tokens
Light: background #f5f4f0, surface #ffffff, elevated #faf9f6, text #252824, secondary #6e746e, border #e4e6de. Dark: background #191c1a, surface #222724, elevated #2a302b, text #f1f2ec, secondary #a1aaa0, border #363d37. Sidebar #1d2621. Accent #bd5736. Music #8b719e, community #608879, traffic #c68a43, weather #5d8ca0, government #7b8390, safety #ad5c52.
Spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Radius: 6 controls, 10 small surfaces, 16 grouped panels; pills only for compact metadata. Typography: system sans (Segoe UI on Windows), editorial headings 32–44px with tight tracking, body 14px, small labels 11–12px. Use tabular numbers for diagnostics and data. Lucide is the only icon family.

## Interaction and motion
140–220ms opacity/translate transitions; no continuous ambient animation. Hover provides subtle surface change. Selected controls have visible fill and border. Keyboard focus uses a high-contrast 2px outline. Escape closes detail panels and search. Reduced motion removes nonessential transitions. Maps, category controls, result lists and charts share filters. Provenance is visible before opening a record.

## Truth and empty states
An always-visible Demo badge and notice identify fixtures. No simulated live scan, fake weather, invented official alerts, or fake progress timers. Onboarding progress reflects local fixture preparation. Empty live mode explains ingestion is a later milestone and offers the explicit demo switch. Offline map is a schematic with a clear label. Trust labels describe the fixture source classification, not verification of a real event.

## Quality guardrails
No purple gradients, neon, glowing cards, excessive glass, decorative chart spam, random 3D objects, or mixed icon packs. Keep light and dark equally composed. Verify desktop and narrow windows, first launch, empty state, filters, detail panel, keyboard navigation, and map failures. Update this file when the visual system changes.
