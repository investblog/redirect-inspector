![Redirect Inspector](assets/banner-1400x560.png)

# Redirect Inspector

Real-time redirect console for developers — trace server & client redirects, run local chain analysis, filter tracking noise, copy clean reports. Zero telemetry.

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/redirect-inspector/jkeijlkbgkdnhmejgofbbapdbhjljdgg)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox-Add--ons-FF7139?logo=firefox&logoColor=white)](https://addons.mozilla.org/firefox/addon/redirect-inspector/)
[![Edge Add-ons](https://img.shields.io/badge/Edge-Add--ons-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ckblhiaefgkhpgilekhcpapnkpihdlaa)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)

## Features

- **Real-time capture** — every server redirect (301, 302, 307, 308) and client-side navigation (JS, meta-refresh) recorded as it happens
- **Session grouping** — chains from the same browsing session grouped by tab, time, and domain affinity
- **9-heuristic analysis** — loops, ping-pong, long chains, mixed types, auth bounces, locale/consent, tracking noise, CDN detection, final outcome
- **Noise filtering** — tracking pixels, analytics beacons, and media sub-requests hidden by default with one-click toggle
- **Side panel** — persistent view alongside your page (Chrome/Edge sidePanel API, Firefox sidebar_action)
- **Dark & light theme** — follows system preference or toggle manually
- **One-click export** — copy chain summary or full analysis report to clipboard
- **7 languages** — English, Spanish, German, French, Brazilian Portuguese, Turkish, Russian
- **Fully local** — no accounts, no analytics, no network requests by default, no data leaves your browser
- **Optional 301.sh news** — opt-in browser notifications for new redirect/DNS/HTTP articles on [301.sh](https://301.sh); off by default, the `notifications` permission is requested only when you enable it

## Install

| Browser | Link |
|---------|------|
| Chrome | [Chrome Web Store](https://chromewebstore.google.com/detail/redirect-inspector/jkeijlkbgkdnhmejgofbbapdbhjljdgg) |
| Firefox | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/redirect-inspector/) |
| Edge | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ckblhiaefgkhpgilekhcpapnkpihdlaa) |

## How it works

Browse normally — Redirect Inspector captures every redirect chain in the background via the webRequest API. Click the toolbar icon to see grouped chains with status codes, hop counts, and timing. Hit the magnifier on any chain to run local analysis: nine heuristics check for loops, ping-pong patterns, mixed redirect types, and more. Copy the full report with one click.

Everything happens locally in the popup or side panel. No data is stored externally, transmitted, or logged.

## Development

```bash
git clone https://github.com/investblog/redirect-inspector.git
cd redirect-inspector
npm install

npm run dev            # Chrome MV3 dev server with HMR
npm run dev:firefox    # Firefox MV2 dev server
npm run build          # Chrome production build
npm run build:firefox  # Firefox production build
npm run build:edge     # Edge production build
npm run zip:all        # Build all platforms
npm run check          # Typecheck + lint + test
```

## Tech stack

- [WXT](https://wxt.dev) — web extension framework with HMR
- TypeScript strict mode
- Vanilla DOM + CSS custom properties (no framework)
- Chrome MV3 + Firefox MV2 + Edge MV3 builds
- Vitest — 74 tests across classify, helpers, and session grouping
- Zero runtime dependencies

## Privacy

Redirect Inspector makes zero network requests by default. No analytics, no telemetry, no remote code. Redirect data is stored in `browser.storage.local` and never leaves the browser. The persisted preferences are theme, noise-filter, and news toggles.

The only optional network activity is the 301.sh news feed: if (and only if) you enable news notifications, the extension fetches `https://301.sh/posts.json` a few times a day to show a browser notification about new articles. Nothing is ever sent — the request carries no identifiers or browsing data, and disabling the toggle stops it entirely.

## Related

- [CookiePeek](https://github.com/investblog/cookiepeek) — privacy-first cookie manager for developers
- [301.st](https://301.st) — advanced domain management with redirects and traffic distribution

## License

[Apache 2.0](LICENSE)

---

Built by [investblog](https://github.com/investblog) at [301.st](https://301.st) with [Claude](https://claude.ai)

## Releasing / store deploy

Version lives **only** in `wxt.config.ts` (`manifest.version`); `package.json` is not
used by the build. To release: bump it, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

A `v*` tag drives two workflows:
- `release.yml` — typecheck/lint/test + a GitHub release with the built ZIPs.
- `submit.yml` — a thin caller of the **shared reusable workflow**
  `investblog/geo-tier-builder/.github/workflows/store-submit.yml@main`.

**Chrome + Edge auto-submit on the tag; Firefox is manual** (Actions → *Submit to
stores* → `stores=firefox`; AMO burns version numbers forever, so it never
auto-runs). The manual dispatch has a `dry_run` toggle that validates
credentials without publishing.

Store credentials are this repo's **GitHub Actions secrets** (`CHROME_*`,
`FIREFOX_*`, `EDGE_*`). API creds are account-level and shared across all
investblog extensions; only the per-extension IDs (`CHROME_EXTENSION_ID`,
`FIREFOX_EXTENSION_ID`, `EDGE_PRODUCT_ID`) differ.

**Before changing the release/CI flow:** confirm the reusable-workflow ref still
resolves and the secrets exist (`gh secret list`). Store publishing here depends
on the external `investblog/geo-tier-builder` workflow — it is a cross-repo
contract, not visible from this repo's code alone.
