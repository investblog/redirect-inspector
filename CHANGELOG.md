# Changelog

All notable changes to Redirect Inspector are documented here.

## [Unreleased]

### Fixed

- **Copied chain summary** — every hop is listed, including consecutive hops on the same host (e.g. `302 /path → /path/`), and URLs are copied verbatim; previously such hops were dropped and the trailing slash and `#fragment` were trimmed, so the "Final URL" could differ from the address bar
- **Clear racing a new chain** — a chain recorded at the moment of Clear could bring the cleared records back; all log changes (record, Clear, Undo, first-install example) are now serialized
- **Undo after Clear** — restores chains recorded just before Clear that the panel had not shown yet
- **Final URL on pages with iframes** — an iframe loading after the page no longer replaces the tab address used to resolve the final URL

## [2.3.1] - 2026-10-01

### Fixed

- **Hanging URL checks** — a check whose page never finishes loading now ends after 20s with a "Timed out after 20s" record (hops captured so far included) instead of a stuck pending item that later vanished without a result
- **Lost chains on tab close** — closing a tab finalizes all of its in-flight chains (previously only the most recent one was cleaned up and the rest lingered as pending); unfinished ones are marked "Tab closed before the chain completed"
- **Stalled chains** — a chain still unfinished after 5 minutes is recorded with a timeout error instead of being discarded
- **Records lost on simultaneous finalization** — writes to the redirect log are serialized
- **Firefox** — `strict_min_version` raised to 140 (Android 142), the first versions that support `data_collection_permissions`

## [2.3.0] - 2026-07-27

### Added

- **Manual URL check** — bottom dock accepts a URL and opens it in an inactive tab; the chain is recorded by the normal pipeline and labeled "Checked by you"
- **Search** — filter chains by URL substring (`/` focuses the filter)
- **Exports** — JSON and cURL export from the analysis drawer
- **Undo for Clear** — 10-second undo in the status strip
- **Help drawer** — keyboard shortcuts (`/`, `?`, `Esc`), tips, and a 301.st promo card
- **Timing and hop deltas** — chain duration, per-hop scheme/path deltas for same-host hops, timestamp legend on the card border
- **Clickable cards** — Ctrl/Cmd/middle-click on a card title opens the final URL
- **Opt-in 301.sh news** — bell toggle in the header; browser notifications for new articles, off by default (`notifications` is an optional permission)
- **First-install example** — a labeled `www.301.st → 301.st` chain so the panel is never empty
- **Full UI translations** — es, de, fr, pt_BR, tr alongside en and ru
- **Uninstall feedback URL**

### Changed

- **Side panel is the default surface on Chromium** — the toolbar icon opens the panel; the popup stays Firefox-only
- **Larger type in side panel mode**; satellite rows mirror the card layout
- **RU ad infrastructure classified as noise** (yandex ads, yastatic, ad.mail.ru, ads.vk.com, mradx, adriver)
- **Store listing** — SEO-oriented name and short description in all locales
- **`tabs` permission removed**
- **Releases are cut only by CI** (`cut-release.yml`), with auto-submission to the Chrome and Edge stores

## [2.2.0] - 2026-02-28

### Added

- **i18n** — English and Russian UI; store listings for es, de, fr, pt_BR, tr

## [2.1.1] - 2026-02-28

### Changed

- Version bump for a Firefox store resubmission (no code changes)

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
