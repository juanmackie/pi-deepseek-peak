# Plan: DeepSeek Peak Status Bar Extension for pi

## Context

Build a new pi extension in this currently empty repository that shows whether DeepSeek API pricing is currently **PEAK** or **OFF-PEAK** in pi's status bar, based on the schedule documented by DeepSeek and implemented by [`YMRYMR/deepseek-peak`](https://github.com/YMRYMR/deepseek-peak).

Confirmed findings:

- DeepSeek's official pricing page defines peak windows of **01:00–04:00 UTC** and **06:00–10:00 UTC**, with all other hours off-peak. Peak rates are 2× off-peak rates.
- The new schedule takes effect at **2026-08-16 16:00 UTC**. Until then, the currently published flat prices apply, so the UI must not imply that a surcharge is already active.
- The reference project computes phase locally from UTC time; no DeepSeek endpoint directly reports the current pricing phase.
- DeepSeek's authenticated `GET /user/balance` endpoint is suitable for the requested API auth/service health check. It returns `is_available` and `balance_infos`; the status bar does not need to expose account amounts. A valid response confirms auth/account reachability, not model inference health.
- The user chose **local schedule + API health**, **phase + countdown**, **pre-cutover phase + badge**, **compact health warning**, and a publishable package named **`pi-deepseek-peak`**.
- The local repository has no implementation files yet.

## Approach

Create a dependency-light TypeScript pi package with one extension entry point and pure schedule/API helpers:

- On `session_start`, compute the phase from UTC and publish a compact footer item with `ctx.ui.setStatus("deepseek-peak", ...)`; update on minute/phase boundaries rather than polling every second.
- Resolve the existing pi DeepSeek credential through `ctx.modelRegistry.getProviderAuth("deepseek")`, then perform a timeout-bounded `GET /user/balance` against that same resolved provider destination at startup and on a conservative five-minute cadence. Bind the resolved `apiKey`, provider headers, and `baseUrl` as one request tuple: use the resolved base URL when present, otherwise the official `https://api.deepseek.com`; never send credentials to a different origin, reject invalid/non-HTTPS destinations, disable redirects, and never log, persist, or render the API key or balance.
- Render the agreed compact contract: `DS ● OFF-PEAK · PRE-CUTOVER · 16h 03m → LIVE` before cutover and `DS ● OFF-PEAK · 02h 13m → PEAK` afterward. The pre-cutover phase is explicitly the would-be schedule phase, not a claim that split pricing is active.
- Keep the phase/countdown available when the key is missing or the network/API is unavailable. Append one compact `⚠` only while auth/account/API health is degraded; do not replace the pricing phase or emit repeated notifications.
- Treat a schema-valid `is_available: false` response as authenticated/reachable but insufficient funds (warning), not as platform downtime—the reviewed upstream plugin currently conflates these states.
- Respect `PI_OFFLINE`; skip the extension-owned health request without treating intentional offline mode as a failure. Use a generation token/in-flight guard so late requests cannot repaint after teardown.
- Use `ctx.ui.theme` for PEAK/OFF-PEAK/pre-cutover colors and clear the named status, timers, and in-flight fetch in `session_shutdown` so `/reload`, `/new`, `/resume`, `/fork`, and exit cannot leak resources.
- Ship raw TypeScript (pi loads it through jiti) as npm package **`pi-deepseek-peak`**, with an explicit `pi.extensions` manifest, npm metadata, Node `>=22.19.0`, tests, docs, and MIT/upstream attribution.

## Files to modify

New files:

- `package.json` — npm/pi package metadata, explicit extension manifest, Node engine, peer/dev dependencies, and validation scripts
- `tsconfig.json` — strict no-emit TypeScript configuration
- `extensions/deepseek-peak/index.ts` — pi lifecycle, status rendering, timers, and health orchestration
- `extensions/deepseek-peak/schedule.ts` — pure UTC phase, effective-date, next-boundary, and countdown calculation
- `extensions/deepseek-peak/deepseek-health.ts` — credential-safe `/user/balance` check, timeout, response validation, and stable result categories
- `test/schedule.test.ts` — cutover, window-boundary, rollover, and countdown tests
- `test/deepseek-health.test.ts` — mocked missing-auth, funded/unfunded success, HTTP, timeout/network, offline, custom-base, and malformed-response tests
- `test/extension.test.ts` — mocked lifecycle/status tests for duplicate starts, non-overlapping checks, stale async completion, cleanup, and sanitized display
- `README.md` — npm/git/local install, credential setup, display semantics, privacy/network behavior, reviewed upstream commit, schedule-maintenance caveat, and authoritative sources
- `LICENSE` — package license
- `THIRD_PARTY_NOTICES.md` — attribution and upstream MIT notice for `YMRYMR/deepseek-peak`
- `package-lock.json` — reproducible development/test dependency resolution (if npm validation creates one)

## Reuse

- Adapt the pure schedule/boundary model from upstream `harness-plugin/src/phase.ts` and preserve its MIT attribution; do not port the React/CSS, queue, balance display, or harness integration.
- Follow pi's `ctx.ui.setStatus()` pattern from `examples/extensions/status-line.ts` and `examples/extensions/model-status.ts`; a named status composes with the default footer, unlike `setFooter()` which would replace it.
- Follow lifecycle requirements in `docs/extensions.md`: start timers/fetches only from `session_start`, make shutdown idempotent, and clean everything in `session_shutdown`.
- Reuse pi's credential resolver (`ctx.modelRegistry.getProviderAuth("deepseek")`) instead of reading `DEEPSEEK_API_KEY` directly. The installed provider definition already maps provider id `deepseek` to that environment/stored credential and `https://api.deepseek.com`.
- Follow `docs/packages.md`: use the `pi-package` keyword, `pi.extensions` manifest, `*` peer range for pi's bundled core package, and keep test/typecheck tools out of runtime dependencies.

## Steps

- [x] Scaffold the publishable `pi-deepseek-peak` package at version `0.1.0` with an explicit raw-TypeScript extension manifest, `pi-package` keyword, Node `>=22.19.0`, strict typecheck, Vitest, and package dry-run scripts.
- [x] Implement pure UTC snapshots with half-open peak windows `[01:00,04:00)` and `[06:00,10:00)`, the exact cutover instant, would-be phase during pre-cutover, next target/boundary, and compact day/hour/minute countdown formatting.
- [x] Implement the DeepSeek health helper using fresh pi-resolved provider auth on every check. Treat `apiKey`, `headers`, and `baseUrl` as one tuple; derive `/user/balance` from the resolved base URL (defaulting only when it is absent), require an HTTPS URL, reject conflicting case-insensitive `Authorization` headers, send a single bearer credential to that same origin, use `redirect: "error"`, an abortable timeout, defensive JSON validation, and sanitized states for funded, insufficient funds, no key, auth/HTTP, network/timeout, malformed response, and intentional offline skip.
- [x] Wire `session_start` to defensively stop prior state, render immediately, schedule drift-resistant minute/phase updates, and launch generation-guarded, non-overlapping health checks no more often than every five minutes.
- [x] Render `DS ● <PHASE> · PRE-CUTOVER · <countdown> → LIVE` before cutover and `DS ● <PHASE> · <countdown> → <NEXT>` after it; append `⚠` for degraded health while leaving the schedule visible and without notifications.
- [x] Wire idempotent `session_shutdown` cleanup for the named status, schedule timer, health timer, active fetch cancellation, and stale-result invalidation.
- [x] Add deterministic schedule/API helper tests plus a mocked extension lifecycle test covering repeated starts, teardown, stale completions, current-theme rereads, and secret/balance non-disclosure.
- [x] Run typecheck, tests, package dry-run, direct-load smoke, and installed-package smoke.
- [x] Document npm/git/local loading, pi's existing DeepSeek login/API-key reuse, exact UI examples, warning meanings, intentional-offline behavior, privacy/network behavior, limitations (host clock and baked-in schedule), reviewed upstream commit `44873104d8afe5a81814205ad6701684c396f709`, authoritative links, and upstream attribution.

## Verification

- Run `npm run typecheck`, `npm test`, and `npm pack --dry-run`.
- Test exact UTC instants immediately before/at/after the cutover; 01:00, 04:00, 06:00, and 10:00 boundaries; midnight/day rollover; and countdown rounding.
- Mock health checks for missing credentials, funded and `is_available: false` success, custom configured base URL, invalid/non-HTTPS base URL, `getProviderAuth()` rejection, conflicting `Authorization` headers, redirect attempts, 401/402/429/5xx, abort/timeout, network failure, malformed JSON, and `PI_OFFLINE`; assert secrets, provider headers, raw bodies, and balance amounts never enter user-facing status text/errors.
- Load directly with `pi -e ./extensions/deepseek-peak/index.ts`, then test an installed package with `pi install ./` and verify the default footer remains intact.
- Observe startup, minute/phase changes, `/reload`, `/new`, `/resume`, `/fork`, theme switch, and quit; ensure there is one status item, no duplicate timers/fetches, late fetches do not repaint, and shutdown clears it.
- Manually verify offline/no-key/invalid-key behavior still shows schedule data and does not spam notifications.
- Compare representative timestamps against upstream `harness-plugin/src/phase.ts` and the official DeepSeek pricing page.
