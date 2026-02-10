# Redirect Inspector

Browser extension that captures and visualizes HTTP redirect chains in real time. See every hop, status code, and timing — directly in the browser side panel.

## Features

### Redirect Tracking
- **Real-time capture** — Records redirect chains as they happen via `webRequest` API
- **Full chain visualization** — Every hop with status code, method, IP, timing, and content type
- **Client-side redirect detection** — Tracks meta-refresh and JS-based redirects with configurable timeout
- **Pending state** — Shows actively resolving chains before they complete

### Noise Filtering
- **Smart classification** — Auto-detects tracking pixels, analytics beacons, and media sub-requests
- **33 known noise domains** — Google Ads, Meta Pixel, Yandex Metrica, Criteo, HotJar, and more
- **Toggle visibility** — Hide or show noise with one click, badge shows hidden count
- **Per-hop tagging** — Each noisy event labeled with reason (tracking keyword, pixel extension, etc.)

### UX
- **Side Panel UI** — Full interface in browser sidebar, always accessible
- **Quick Actions Popup** — Status overview, open panel, clear log, rate on CWS
- **Dark / Light theme** — Follows system preference, manual toggle available
- **Sticky collapsible header** — Controls hide on scroll down, reappear on scroll up
- **Copy to clipboard** — Export any redirect chain as formatted text
- **Badge counter** — Icon badge shows redirect count per tab

## Installation

### Chrome Web Store
[Redirect Inspector](https://chromewebstore.google.com/detail/redirect-inspector/jkeijlkbgkdnhmejgofbbapdbhjljdgg)

### Firefox Add-ons
Coming soon...

### Manual Installation (Development)

```bash
git clone https://github.com/investblog/redirect-inspector.git
cd redirect-inspector
npm install
npm run dev
```

Load the extension:
- **Chrome**: `chrome://extensions` -> Developer Mode -> Load unpacked -> select `dist/chrome-mv3`
- **Firefox**: `about:debugging` -> Load Temporary Add-on -> select `dist/firefox-mv2/manifest.json`

## Usage

1. Click the extension icon to open the popup
2. Click **Open Full Panel** to launch the side panel
3. Browse the web — redirect chains appear automatically
4. Click any chain to expand and see every hop
5. Use the **Copy** button to export a chain as text
6. Toggle **Show pixel, analytics & media requests** to reveal noise

## Tech Stack

- **Framework**: [WXT](https://wxt.dev/) (Chrome MV3 + Firefox MV2)
- **Language**: TypeScript
- **Linter**: Biome
- **Tests**: Vitest (52 specs)
- **UI**: Vanilla DOM + CSS custom properties (301.st design system)

## Project Structure

```
src/
├── entrypoints/
│   ├── background/index.ts      # Listener registration, message router
│   ├── popup/                    # Mini popup (status + open panel)
│   └── sidepanel/                # Main UI (redirect list, filters, export)
├── background/
│   ├── chains.ts                 # Chain lifecycle (create, attach, finalize)
│   ├── classify.ts               # Noise classification (tracking, media, pixels)
│   ├── badge.ts                  # Tab badge rendering and countdown
│   ├── helpers.ts                # URL utils, header parsing, constants
│   └── index.ts                  # Re-exports
├── shared/
│   ├── types/redirect.ts         # RedirectRecord, RedirectEvent, Chain
│   ├── messaging/                # Type-safe message protocol
│   └── theme.ts                  # Dark/light theme management
├── assets/css/                   # Styles (theme tokens, panel, popup)
└── public/icons/                 # Extension icons (16, 32, 48, 128)
```

## Development

```bash
npm run dev            # Dev server (Chrome)
npm run dev:firefox    # Dev server (Firefox)
npm run build          # Production build (Chrome)
npm run build:firefox  # Production build (Firefox)
npm run zip:all        # Create zips for store submission
npm run typecheck      # TypeScript check
npm run lint           # Biome lint
npm run test           # Run tests
npm run check          # All checks (typecheck + lint + test)
```

## Privacy

- **No data collection** — Zero analytics, zero tracking, zero telemetry
- **Local only** — All data stored in `browser.storage.local`, never leaves the browser
- **No remote calls** — Extension makes zero network requests of its own
- **Open source** — Full code available for audit

## Related

- [301.st](https://301.st) — Advanced domain management with redirects, TDS, and multi-account orchestration
- [Cloudflare Tools](https://github.com/investblog/cloudflare-tools) — Bulk operations for Cloudflare zones

## License

Apache 2.0 — see [LICENSE](LICENSE).

## Issues

[Report bugs or request features](https://github.com/investblog/redirect-inspector/issues)
