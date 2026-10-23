# Backlog

Candidates for 2.4.0+, ranked. Sources: competitor analysis (RedirectCheck,
CWS id pndfafcgnfdkbijjhjngocaocflkmahm, 2026-07-27), UX audit leftovers,
user reports.

## 2.4.0 candidates

1. **Bulk URL check** (M) — multi-line input in the bottom dock; queue of
   inactive probe tabs with a concurrency cap (~3); results land in the log as
   `manual` chains; batch export. Closes the competitor's only real advantage;
   key scenario: site-migration audits. Builds directly on `src/background/probe.ts`.
   Since 2.3.1 the groundwork is there: every probe ends in a record (20s timeout
   finalizes stalled chains), and log writes are serialized (`background/log.ts`),
   so parallel probes no longer lose records. A local harness that loads the
   built extension into Chromium and probes redirect/hang endpoints proved both;
   rebuild it for the bulk-check tests (it was a scratch script, not committed).
2. **CSV export** (S) — add to the analysis-drawer export set (report/JSON/cURL).
   Flat schema: `chain_id, hop, from, to, status, duration_ms`. SEO crowd lives
   in spreadsheets.
3. **Manifest-only ASO locales** (S) — extName/extDescription in ~20–30 extra
   languages (store search visibility), UI stays fully translated in the current 7.
   Competitor ships 52 locales this way.

## Bugs found by the harness (2026-10-22)

- **JS redirect after load is not a hop (Chromium)** — `webRequest.onCompleted`
  arrives just before `webNavigation.onCommitted`, and `handleWebNavigationCommitted`
  then cancels the client-redirect wait and records the chain ~250 ms after
  commit. A `location.href = …` the page runs later (0.8 s in the harness) starts
  a new, unrelated navigation instead of a `JS` hop. Firefox keeps the chain open
  (different event order) and attaches it. Decide what the wait should key on
  before touching it — it also sets how long manual-check tabs stay open.

## Client-side landing — follow-ups

- **Analysis**: a `CLIENT_LANDING` info heuristic ("final page set client-side;
  crawlers see <finalUrl>"), a tag chip, the row in the analysis drawer and its
  report; the open drawer should refresh when a landing is patched in.
- **Masking scope**: hop URLs (`events[].from/to`) are still stored with their
  query unmasked (pre-existing); tokens in path segments and nested encoded URLs
  are not detected. Decide deliberately — masking hops changes what users see.

## Cosmetic

- **Meta-refresh badge** — client-side hops (script and meta refresh) currently
  share one `JS` badge (`chains.ts` hardcodes `statusCode: 'JS'` in both
  client-hop sites). Caveat: `webNavigation.onCommitted` only exposes the
  `client_redirect` transition qualifier and does not distinguish meta refresh
  from script navigation — needs a heuristic (e.g. timing vs the page's meta
  tag) or page access. Consider a neutral "client" badge as the honest fallback.
- Card-title open affordance (UX audit m5): ctrl/cmd/middle-click works but is
  mouse-only and undiscoverable; consider keyboard access + cursor hint.

## Consider deliberately (architecture/permission trade-offs — decide, don't drift)

- **SEO signals on manual checks** (canonical / noindex / robots) — requires
  reading page content in the probe tab → new `scripting` permission right
  after the permissions cleanup. Only with a strong story.
- **Per-hop response headers (opt-in subset)** — conflicts with the deliberate
  "headers are never persisted" rule (CLAUDE.md). If ever: whitelist only
  (location, cache-control, server, x-redirect-by), opt-in, revisit consciously.
- Loop alert notifications — heuristics already flag loops in analysis; an
  active toast would need `notifications` beyond the news opt-in scope.
