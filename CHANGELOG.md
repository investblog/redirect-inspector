# Changelog

All notable changes to Redirect Inspector are documented here.

## [2.1.0] - 2026-02-28

### Added

- **Welcome page** — onboarding page opens on first install with feature overview, tips, and CTA button
- **Session grouping** — redirect chains are grouped by browsing session (tab + time + domain affinity)
- **Chain analysis drawer** — slide-in panel with 9 heuristics: chain length, loops, ping-pong, mixed redirect types, final outcome, auth bounces, locale/consent, tracking noise, CDN detection
- **Shimmer pending state** — in-progress chains show an animated shimmer effect
- **Side panel support** — same UI reused as a persistent side panel (Chrome/Edge: sidePanel API, Firefox: sidebar_action)
- **Noise filtering** — hide tracking and media redirect chains by default, with toggle and hidden count badge
- **Per-browser store icons** — Chrome, Edge, Firefox SVG icons with review/rate links in the footer
- **Status code tooltips** — hover any status badge (301, 302, JS, HSTS, etc.) to see its meaning
- **Severity badges in drawer** — analysis summary shows colored pill badges (error/warning/info) instead of plain text

### Fixed

- **Success status footer restored** — redirect cards show "Completed with status 200" in green for successful responses, not just errors
- **Satellite status colors** — sub-chain status badges now use correct colors (green for 301/308, yellow for 302/307, blue for JS)

### Changed

- **Navigation-split grouping** — A-B-A browsing patterns within the same tab correctly split into separate session groups
- **Welcome tip icons** — use arrow-right icon instead of directions-fork for clearer visual

## [2.0.2] - Initial tracked release

Unified popup and side panel entrypoint, cross-browser builds (Chrome MV3, Firefox MV2, Edge MV3), Biome linting, Vitest test suite.
