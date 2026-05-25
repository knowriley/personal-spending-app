# PRD v2: MoneyHabits as a real app

> Phase: v2 (the proof-of-concept is v1).
> Target shape: installable PWA. iPhone, iPad, and Mac get a home-screen / dock icon and a chromeless launch experience.
> Hosting: Render (static site, free tier).
> Backend: none at runtime. The Flask app becomes a build-time script that pre-computes every API response to static JSON.
> Mobile nav: bottom tab bar.
> Users: one (the author). No accounts, no auth, no multi-tenancy.
> Data: the existing two personas + dropdown switcher. No real-bank integration.
> Out of scope for v2: dark mode (revisit in v3+).

This document is the anchor for a planning suite. Each section below is a one-paragraph summary that points to a dedicated doc where the real work lives. The point of this overview is to lock the vision, scope, and non-goals so the detailed docs can move fast without re-litigating fundamentals.

---

## 1. Vision

MoneyHabits v2 is the same app as v1 — but it lives on the home screen, opens like an app, works at phone widths, and is reachable from anywhere without `python app.py` running on a laptop. The proof-of-concept showed that the analytical surfaces (Overview, Habits, Transactions) are useful. The phase-2 work is about graduating those surfaces from "neat demo on `localhost:5001`" to "tool the author actually uses, on the device they have, in the situations where personal finance questions actually come up."

Concretely, the bar is: opening MoneyHabits on the subway, on a phone, with one thumb, should feel as native and as smooth as opening any first-party iOS app. Anything that betrays the "this is a web page" mental model — Safari chrome, pinch-to-zoom on a chart, a tap delay, a desktop-shaped layout that requires horizontal scroll — is a v2 bug.

---

## 2. Goals

The phase-2 work is a success if all of the following are true:

1. **Installable.** The author can install MoneyHabits to the iOS home screen and to the macOS dock as a real-feeling app, with a proper icon, splash screen, and chromeless launch. No Safari URL bar, no tab strip.
2. **Reachable.** The app is available at a stable Render URL with no server process running. As a static site, every visit is fast — no cold start, no spin-up delay, no backend to maintain.
3. **Mobile-grade.** Every surface — Overview, Habits, Transactions — works comfortably on a 390pt-wide iPhone. No horizontal scrolling, no overlapping chart elements, no controls smaller than 44pt tap targets. Charts read at phone widths. The Habits drill-down (the densest surface) has a phone layout designed deliberately, not by accident of `md:` breakpoints.
4. **Offline-resilient.** A second launch with no network shows the last-cached view of the active persona rather than a blank screen or a browser error. Going offline mid-session degrades gracefully.
5. **Fast.** First contentful paint on a warm cache is under one second on a recent iPhone over LTE. Tab switches feel instantaneous.
6. **Persona parity.** Both personas remain available; the dataset switcher continues to work and remains discoverable on small screens (its current top-right desktop placement does not survive a phone layout untouched).

---

## 3. Non-goals

Explicitly out of scope for v2. Calling these out so they don't quietly creep back in:

- **No new analytical surfaces.** No new tabs, no budgeting feature, no income-vs-spending viz (the dormant `_df_full` stays dormant for now). The point of v2 is platform maturity, not feature growth.
- **No accounts, no auth, no multi-user.** Single user. No login screen. The site is publicly reachable but contains only synthetic persona data, so there's no privacy surface to protect.
- **No real bank data.** No Plaid, no MX, no CSV upload from the running app. Persona CSVs continue to ship in the repo and be re-baked into static JSON via the build script.
- **No live backend at runtime.** All API responses are pre-computed at build time. The Flask app from v1 is retained only as a build-time utility (it gets called by `build_static.py`). Nothing server-side runs in production.
- **No native code.** No Swift, no React Native, no Capacitor wrapper. The decision to go PWA was deliberate; revisiting it is a v3 question, not a v2 question.
- **No iOS-only features that require native.** No widgets, no Lock Screen complications, no Siri Shortcuts, no push notifications. These would all be reasons to reopen the native-vs-PWA question; they are not v2 work.
- **No build step for application code.** Vanilla JS stays vanilla JS. The Tailwind pre-build step stays. No bundler is being introduced for app code.
- **No design-system rewrite.** The tokens, typography scale, and component vocabulary in `DESIGN-SYSTEM.md` are kept; mobile is an *extension* of the system, not a replacement.

---

## 4. Scope summary

The work decomposes into six concerns, each covered by its own document:

| # | Doc | What it covers |
|---|---|---|
| 1 | `PRD-v2-overview.md` *(this doc)* | Vision, goals, non-goals, success criteria. Anchors the suite. |
| 2 | `PRD-v2-feature-spec.md` | Per-surface behavior on mobile vs. desktop. What changes, what stays, what gets cut from a small screen. Includes the dataset-switcher relocation. |
| 3 | `PRD-v2-mobile-design.md` | Bottom tab bar spec, Habits drill-down on phone, chart density and touch interaction, type scale at small widths, safe-area handling, where the page header / dataset switcher live. The densest doc. |
| 4 | `PRD-v2-pwa-shell.md` | Manifest, icon set (every required size for iOS + Android + macOS), iOS splash screens, service worker strategy (cache-first assets + SWR for JSON), offline behavior, install instructions. |
| 5 | `PRD-v2-engineering.md` | The `build_static.py` script (what it pre-computes, file layout under `dist/api/`), client-side transactions filtering, Render static-site deploy pipeline, repo structure changes, persona switching as a frontend-only operation. |
| 6 | `PRD-v2-phasing.md` | What ships in each milestone, with explicit cut lines. Minimum viable installable build, then mobile polish, then offline, then deploy hardening. |

Each doc is meant to stand alone. A future contributor — or a future Claude — should be able to read any one of them and execute on it without needing to read the others. Cross-references are explicit when needed.

---

## 5. Success criteria

Observable outcomes, not engineering checklists. v2 ships when all of these are true:

1. **The home-screen test.** The author opens MoneyHabits on iPhone by tapping a home-screen icon. The app launches full-screen with a splash. No Safari UI is visible at any point. The dataset switcher is discoverable in under three seconds. Both personas can be selected, and the active selection persists across launches.
2. **The subway test.** The author opens MoneyHabits on the subway (no signal). The last-viewed tab renders against the cached data. Switching personas while offline shows a clear "offline, cached data" indication rather than a broken state.
3. **The thumb test.** Every interactive control on every tab can be operated one-handed on a 390pt iPhone screen. No control is below the 44pt minimum tap target. Nothing critical lives in the bottom-left corner where it requires a hand shuffle.
4. **The Mac dock test.** The author launches MoneyHabits from the macOS dock. It opens in its own window (not a Safari tab). The desktop layout is preserved. Window resize is smooth.
5. **The "send a friend the link" test.** A friend opens the URL on their phone with no installation. The app loads, both personas are visible, the friend can poke around without anything breaking. (The data is synthetic personas, so there's no privacy concern.)
6. **The 30-day test.** Thirty days after launch, the author has opened the app at least five times on their phone unprompted, because it was the easiest way to answer a real personal-finance question.

The first five are pre-launch checks. The sixth is the only one that matters — it determines whether the platform work paid for itself.

---

## 6. Resolved decisions

The following were open in earlier drafts and are now locked. The doc where each is implemented is noted in parentheses.

- **Mobile nav: bottom tab bar.** Three tabs (Overview, Habits, Transactions), thumb-reachable. The current "secondary nav owns page titling" pattern (see `CLAUDE.md`) needs a mobile-specific rework — the page title moves into the content area at phone widths. (Mobile design doc.)
- **Hosting: Render static site, free tier.** No backend at runtime. (Engineering doc.)
- **Backend: pre-computed to static JSON at build time.** The existing Flask app is repurposed into a build script (`build_static.py`) that hits every API endpoint for every persona × month × scope combination and writes the responses to a `dist/api/` tree. The deployed site is `dist/`. The dataset switcher becomes a pure frontend state change — pick a different folder of JSON files. Transactions filtering moves client-side. (Engineering doc.)
- **Dataset switcher: gear icon → Settings sheet.** The v1 top-right dataset switcher dropdown is replaced by a gear icon (top-right of the sticky page header on mobile, bottom of the side rail on desktop) that opens a Settings sheet containing the persona switcher + About footer. The active persona is named in the Overview eyebrow (`Overview · NYC Student`) as quiet, persistent context. (Feature spec §5; mobile design §2.2 and §4.)
- **Service worker strategy: cache-first for static assets, stale-while-revalidate for the pre-computed JSON.** Since there's no live backend, "stale" means "older than the last deploy" — which is exactly what we want. (PWA shell doc.)
- **Dark mode: deferred to v3.** Light-only in v2. (Mobile design doc notes this constraint but does not implement.)

- **Habits drill-down: right-side flyout (Pattern B).** Click a bar to open. Full-screen on mobile, pushes Trends to ~50% on desktop. (Feature spec §3.4; mobile design §4.3.)
- **Build pipeline: Render at deploy time.** `dist/` is gitignored. Render runs `build_static.py` on every push to the connected branch. (Engineering doc §10.)
- **Service worker versioning: build-hash-suffixed cache names.** `moneyhabits-shell-${BUILD_HASH}` and `moneyhabits-data-${BUILD_HASH}`. Activate event deletes any cache whose name doesn't match the current hash. (PWA shell §5.2 / Engineering §8.)

## 7. Still-open questions

Nothing material remains open at the suite level. Each implementation doc may have its own small TBDs (final icon design, exact splash mark positioning, etc.) — those are tracked in the docs themselves, not here.

---

## 8. What happens next

The next doc in the suite is `PRD-v2-feature-spec.md` — the per-surface walkthrough. It is the doc that determines what gets cut, condensed, or rethought on small screens, and it's the input to the mobile design doc that follows it.

Before drafting it, the author and Claude will agree on the answers to a small set of feature-cut questions (in the next conversation turn): things like "does the Habits chart timeframe selector live in the same place on phone?" and "does the transactions filter set keep all four filters at phone widths or collapse to a single search-plus-modal pattern?"
