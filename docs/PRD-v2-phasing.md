# PRD v2: Phasing

> Scope: sequencing the v2 work into shippable milestones.
> Companion docs: `PRD-v2-overview.md` anchors the suite, `PRD-v2-feature-spec.md` defines behavior, `PRD-v2-mobile-design.md` defines design, `PRD-v2-pwa-shell.md` defines manifest + SW, `PRD-v2-engineering.md` defines the build pipeline.
> Reading order: read this doc last; refer back to the others as each milestone lands.

This is the execution plan. The work is sequenced strictly serial — finish milestone N before starting N+1. Each milestone is sized to finish in roughly a few hours of focused work; the largest are half-day items, none should sprawl into multi-day undertakings without being decomposed further.

A guiding principle: **every milestone leaves the app in a working state**, even if briefly. The walking-skeleton (M0) proves the pipeline before any feature work begins; subsequent milestones swap one thing at a time. v1 keeps running locally as a development reference throughout most of the build.

---

## 0. Reading the milestone format

Each milestone below has three parts:

- **Goal**: a one-sentence "done" statement. If this isn't true, the milestone isn't finished.
- **Scope**: what gets built. Cross-references to the relevant doc + section.
- **Verification**: how you know it's done. Concrete, observable. No "looks good" criteria.

If a milestone's verification can't be satisfied, the milestone is incomplete — don't paper over it by moving on. Each one is small enough that finishing properly is faster than fixing-later.

---

## M0 — Walking skeleton

**Goal**: a `/dist` tree deploys to Render, serves a trivial HTML page that fetches one trivial JSON file, and the URL works in a phone browser.

**Why this exists**: before any real v2 work, prove the deploy pipeline end-to-end. Render's static-site quirks, manifest MIME types, env var injection, the build command — all of these break in unexpected ways. Discover the breaks against a trivial payload, not against a 1,900-file production tree.

**Scope**:
- Create `build_static.py` as the simplest possible script: writes a `/dist/index.html` that contains "Hello MoneyHabits" and fetches a hardcoded `/dist/api/hello.json`. No `data_processor` import yet.
- Create `render.yaml` per engineering doc §10.1.
- Push to a new branch (e.g., `v2`), connect Render to it.
- Verify deploy succeeds. Open the deployed URL on a phone.

**Verification**:
- [ ] Pushing to the `v2` branch triggers a Render deploy
- [ ] Deploy completes without errors
- [ ] The deployed URL serves the "Hello MoneyHabits" page
- [ ] The JSON fetch succeeds and the page can display its content
- [ ] Loading the URL on an iPhone works

**Out of scope**: PWA manifest, service worker, real data, real design. M0 proves the *pipeline*, not the app.

---

## M1 — Data layer refactor

**Goal**: every v1 API endpoint's logic is callable as a Python function on `data_processor`, with no `request.args` dependencies inside.

**Why this exists**: the build script needs to call computation functions directly (engineering doc §3.2 decision). v1 has some logic in `app.py` route handlers that needs to move down into `data_processor.py`. v1 keeps running afterward — this is a pure refactor.

**Scope**:
- Move `top_categories(year_month, exclude=None)` from `app.py` to `data_processor.py`
- Move/expose `transactions_all()` as a clean function
- Move/expose `radial(level, category)` similarly
- Wherever `request.args.get(...)` lives inside a route, pull that into the function signature
- Update `app.py` routes to be thin wrappers around the refactored `data_processor` functions
- Verify v1 still works: `python app.py`, hit every endpoint, confirm responses identical

**Verification**:
- [ ] Every v1 endpoint returns the same JSON it did before the refactor (test via `curl` or browser)
- [ ] `data_processor` functions can be called directly from a Python REPL without Flask running

**Out of scope**: no new functionality. No v2 logic. Pure refactor.

---

## M2 — Real build script + first persona

**Goal**: `python build_static.py` produces a `/dist/api/student/` tree with every required JSON file, matching what v1's Flask endpoints would return.

**Why this exists**: this is the v1 → static migration's foundation. After this, the data side of v2 is real.

**Scope**:
- Replace M0's trivial `build_static.py` with the real one (engineering doc §3.5)
- Implement `precompute_persona()` for `student` only
- Generate every file per engineering doc §3.3:
  - `categories.json`, `months.json`, `category-meta.json`, `category-hierarchy.json`, `transactions.json`, `overview-snapshot.json`, `top-categories-*.json`, `summary-*.json`, `monthly-*.json`, `category-detail-*.json`, `radial-*.json`
- Write helper functions: `scope_slug()`, `derive_avg_range()`, `write_json()`
- Add a `verify()` step that confirms every expected file exists
- Compare a few generated JSON files against v1's live endpoint responses for the same params — they should be identical content

**Verification**:
- [ ] Running `python build_static.py` produces ~950 files under `/dist/api/student/`
- [ ] `verify()` passes
- [ ] Spot-check 5 random generated files against v1's live responses for the same parameters — all identical
- [ ] Build completes in under 90 seconds

**Out of scope**: second persona, asset generation, frontend changes, templating.

---

## M3 — Second persona + personas.json

**Goal**: both personas are pre-computed. `personas.json` exists at the API root.

**Scope**:
- Loop `precompute_persona()` over `dp.DATASETS.keys()`
- Write `/dist/api/personas.json` per engineering doc §3.3 (`/api/datasets` replacement section)
- Spot-check the `young-pro` tree

**Verification**:
- [ ] `/dist/api/young-pro/` exists with the same file structure as `student/`
- [ ] `/dist/api/personas.json` exists and lists both personas with `key` and `label`
- [ ] Total file count is ~1,900

**Out of scope**: anything frontend.

---

## M4 — Asset pipeline (icons + splash screens)

**Goal**: `python build_assets.py` generates all PNGs from SVG sources. `build_static.py` calls it automatically.

**Why this exists**: assets are needed before the PWA manifest can be wired. Generating them now also surfaces design decisions early (does the wordmark icon read clearly at 60×60pt?).

**Scope**:
- Create `static/icons/source.svg` and `static/splash/source.svg` — at minimum, a placeholder design with a centered "M" wordmark. Final design can iterate later but the build pipeline needs *something*.
- Add `cairosvg` to `requirements.txt`
- Write `build_assets.py` per engineering doc §5
- Wire it into `build_static.py` as step 2
- Generate `favicon.ico` (32×32 multi-resolution) using Pillow

**Verification**:
- [ ] All 11 icon files exist under `/static/icons/` after `build_assets.py` runs
- [ ] All 9 splash screen files exist under `/static/splash/`
- [ ] `favicon.ico` exists
- [ ] Opening any generated icon at its target size in a browser, the mark is readable
- [ ] `build_static.py` calls `build_assets.py` and the files end up under `/dist/static/`

**Out of scope**: the final visual design of the icon. The mark can be improved without rebuilding the pipeline.

---

## M5 — PWA manifest + meta tags

**Goal**: a phone can install the deployed v2 to its home screen, and the app launches in standalone mode (no Safari chrome).

**Why this exists**: this is the "feels like an iOS app" moment. After this, the home screen test from the overview doc starts to pass.

**Scope**:
- Create `manifest.template.json` and have `build_static.py` substitute `__BUILD_HASH__` (PWA shell doc §1.1)
- Update `templates/base.html` with the full head meta tag set (PWA shell doc §4)
- Implement `render_index_html()` using Jinja `Environment` to render the templates and substitute `DEPLOY_URL` (engineering doc §6.1)
- Deploy to Render
- Add deployed URL to a real iPhone's home screen via Share → Add to Home Screen

**Verification**:
- [ ] Lighthouse PWA audit shows manifest valid + installable
- [ ] On iPhone: tap-and-hold the home screen icon → "Add to Home Screen" prompt works
- [ ] Launching from the home screen opens the app full-screen with no Safari chrome
- [ ] The splash screen renders correctly (matches design language)
- [ ] The app's home-screen label says "MoneyHabits"

**Out of scope**: service worker (no offline yet — that's M6). Frontend changes beyond what's needed to load the manifest correctly.

---

## M6 — Service worker

**Goal**: opening the app on a phone with no network loads from cache and works at the last-cached state.

**Scope**:
- Create `service-worker.template.js` per engineering doc §8
- Build script substitutes `__BUILD_HASH__` and the actual SHELL_URLS list from the generated tree
- Register the SW from `app.js`
- Test offline behavior

**Verification**:
- [ ] After first visit, the app loads instantly on second visit
- [ ] In Safari devtools → Service Workers, the SW is registered and active
- [ ] Toggle airplane mode after first visit, reload — page loads, charts render against cached data
- [ ] After a deploy with a new BUILD_HASH, reloading the app twice (once to download new SW, once to activate it) shows the new build
- [ ] Old caches (with old BUILD_HASH suffixes) are deleted on activation

**Out of scope**: the install banner (M14).

---

## M7 — `ios.js` primitives

**Goal**: the bottom-sheet, right-flyout, swipe-dismiss, and large-title-scroll behaviors all work in isolation against a test page.

**Why this exists**: these are the building blocks. Every tab depends on them. Building them in isolation, then composing them, is faster than discovering primitive bugs while building UI surfaces.

**Scope**:
- Create `static/js/ios.js` with the API surface from engineering doc §4.4
- Create a test HTML page (`tests/ios-playground.html`) with buttons that exercise each primitive
- Implement each primitive per mobile design doc §4:
  - `openBottomSheet()`, `closeBottomSheet()` with backdrop, single-detent, grab-handle, swipe-down dismiss, scroll lock, focus trap
  - `openRightFlyout()`, `closeRightFlyout()` with backdrop (desktop only), push-on-desktop animation, swipe-right dismiss (mobile), X button, scroll lock
  - `initLargeTitleScroll()` — the 60pt scroll-driven interpolation between large and sticky
  - `wireSwipeDismiss()` — reusable swipe handler
- All animations use `cubic-bezier(0.32, 0.72, 0, 1)` and the durations specified in mobile design doc §4

**Verification**:
- [ ] Bottom sheet opens, swipe-down dismisses, tap-backdrop dismisses, body scroll locks during open, focus traps inside
- [ ] Right flyout opens and pushes content on desktop (≥768px viewport)
- [ ] Right flyout slides full-screen on mobile (<768px)
- [ ] Large-title scroll animation runs smoothly on iOS Safari with momentum scroll
- [ ] No console errors in any of the test scenarios

**Out of scope**: integration with actual app tabs. Visual polish — that comes when each primitive is composed into a real surface.

---

## M8 — Chart.js conversion (all charts except radial)

**Goal**: every chart in the v1 app that's not the radial chart renders via Chart.js instead of Plotly, against the static JSON tree.

**Why this exists**: this is a focused, isolatable rewrite. After this, Plotly comes out of the codebase entirely.

**Scope**:
- Add `static/js/chart.umd.min.js` (local copy of Chart.js 4.x)
- Implement `chartLayout()` helper per mobile design doc §8.2
- Implement Chart.js global defaults config per mobile design doc §8.1
- Convert each chart in order, per engineering doc §13 step 5:
  1. Overview cumulative line
  2. Habits trend bar (with stacked variant)
  3. Drill-down pie (with proportion/composition modes)
  4. Drill-down cumulative line
  5. Drill-down bubble chart (desktop only)
  6. Drill-down daily-totals strip (mobile only — new chart for v2)
- Remove Plotly CDN script tag, remove `plotlyLayout()`, remove `setChartA11y()`, remove the custom tap-and-hold tooltip system
- Each chart fetches data via `fetchJsonCached()` from the appropriate persona's static JSON

**Verification**:
- [ ] Every chart renders correctly at the same data points as v1
- [ ] Tooltips work on touch (tap a chart element on iPhone, tooltip appears)
- [ ] Stacked toggle on Habits trend bar still works
- [ ] Proportion/composition toggle on drill-down pie still works
- [ ] Bubble chart's hover→table link still works on desktop
- [ ] No Plotly references remain in the codebase (`grep -r Plotly` returns nothing)
- [ ] First load is meaningfully smaller than v1 (chart bundle is ~200KB vs ~1MB)

**Out of scope**: the radial chart (M9). Habits drill-down restructure (M11).

---

## M9 — Custom radial chart (`radial.js`)

**Goal**: the year-over-year radial chart renders as hand-rolled SVG, matching v1's behavior at desktop widths.

**Scope**:
- Create `static/js/radial.js` per engineering doc §7
- Implement `MoneyHabitsRadial.render()` and `destroy()` 
- Implement year-pinning, color resolution from `--color-radial-*` tokens, click hit-testing on month sectors
- Wire it into the Habits tab's chart-type toggle (replacing Plotly's `scatterpolar` calls)

**Verification**:
- [ ] On a ≥768px viewport, toggling chart-type to "Radial" renders the v2 SVG
- [ ] Selecting/deselecting years shows/hides rings correctly
- [ ] Clicking a month sector triggers `setLensMonth` and the drill-down behavior
- [ ] Year colors map to `--color-radial-0..5` by recency (most-recent year → palette index 0)
- [ ] Empty-state overlay renders when no selected years have spending
- [ ] On <768px viewports, the radial toggle is hidden (CSS already handles this from v1)

**Out of scope**: any visual refinement beyond matching v1's behavior. The polish round is M13.

---

## M10 — Navigation restructure (tab bar + side rail + large-title page headers)

**Goal**: the v1 secondary nav is gone. Mobile users see a bottom tab bar; desktop users see a left side rail. Page headers use the large-title pattern across all three tabs.

**Why this exists**: this is the biggest structural UI change in v2. Doing it as a discrete milestone — without simultaneously restructuring per-tab content — keeps the change reviewable.

**Scope**:
- Remove v1's secondary nav markup from `base.html`
- Add bottom tab bar markup (visible <768px)
- Add side rail markup (visible ≥768px)
- Move the gear icon to top-right of sticky header (mobile) and bottom of side rail (desktop)
- Implement tab switching via the bottom tab bar and side rail
- Add hash-based routing (`#overview`, `#habits`, `#transactions`) for browser back-button support
- Implement large-title block + sticky-header system per mobile design doc §3, calling `initLargeTitleScroll()` from M7
- Each tab's H1 + eyebrow content is wired but tab content can still use v1 layouts inside

**Verification**:
- [ ] On iPhone: bottom tab bar visible, three tabs work, gear icon top-right opens the Settings sheet placeholder
- [ ] On desktop: left side rail visible, three tabs work, gear icon at the bottom of the rail
- [ ] Large title shrinks into sticky header on scroll (verify the 60pt-of-scroll interpolation feels smooth on real iPhone)
- [ ] Back button navigates between previously-visited tabs
- [ ] No console errors

**Out of scope**: tab content changes — Overview still shows the four-card v1 grid, Habits still shows KPI strip + always-rendered drill-down. Per-tab restructuring comes in M11-M13.

---

## M11 — Overview restructure + Habits flyout

**Goal**: Overview shows the three-card stacked layout (snapshot, cumulative, top categories — no 3-month average, no last-month card). Habits drill-down is a right-side flyout, not an always-rendered section. The KPI strip is gone.

**Why this exists**: these are the two biggest tab-level restructurings. Doing them in one milestone is justified because they're both about "removing v1 layouts and adopting v2 patterns" — the work is shaped the same way.

**Scope**:
- **Overview**:
  - Delete `renderCard2()` and `renderCard3()` markup + JS
  - Restructure `renderCard1()` to absorb just the smart message (no raw last-month $ value)
  - Reposition `renderCard4()` (top categories) below the chart
  - Replace dual-line cumulative default with single-line + overlay toggle in card header
  - Wire the month picker to use `openBottomSheet()` on mobile, keep dropdown on desktop
  - Add the persona caption to the eyebrow (`Overview · NYC Student`)
- **Habits**:
  - Delete the KPI strip markup + render functions
  - Delete the always-rendered drill-down section (`#habits-drilldown`)
  - Delete the `dd-month-btn` chip and `buildDrillDownMonthPanel()`
  - Wire the bar chart's click handler to open a flyout via `openRightFlyout()` instead of scrolling to a drill-down
  - The flyout contents are the existing drill-down sections (pie/quick-stats/cumulative/locations/bubble/table) rendered into the flyout's content area
  - Implement the daily-totals strip (mobile B3 replacement for the bubble chart) — small bar chart per day
  - Pie chart's proportion/composition toggle moves to a segmented control band above the pie

**Verification**:
- [ ] Overview shows three vertically-stacked cards, no four-card grid
- [ ] Card 1 has its smart message; no separate last-month card; no 3-month average card
- [ ] Cumulative defaults to single line; toggling the card-header switch overlays April
- [ ] Top categories card sits below the chart, chip-list unchanged from v1
- [ ] Habits shows just the chart (with controls); no KPI strip, no drill-down section
- [ ] Tapping a bar in the Habits chart opens the flyout from the right (push on desktop, full-screen on mobile)
- [ ] Flyout dismissal works via X button, swipe right, and (desktop only) tap-outside
- [ ] On mobile drill-down, bubble chart is replaced by the daily-totals strip
- [ ] Persona caption appears in Overview eyebrow only, not on other tabs

**Out of scope**: Transactions restructure (M12). Settings sheet content (M13).

---

## M12 — Transactions restructure

**Goal**: Transactions tab loads from `transactions.json` once, filters client-side, displays grouped-by-month with "Load older" pagination.

**Scope**:
- Delete `txnPage` / Prev / Next pagination code + markup
- Delete `txn-count` line markup
- Delete server-side filter URL params (`start_day`, `end_day` from cross-tab nav still apply as client-side filter)
- Load all transactions for the active persona on tab activation; cache in `_allTransactions`
- Implement `getFilteredTransactions()`, `groupByMonth()`, `renderTransactions()` per engineering doc §4.5
- Initial render: 3 most recent months (or 3 most recent months with matches if filtered)
- "Load older" button: explicit-month label (`Load February 2026 →`)
- Reduce search debounce from 300ms to 100ms
- Switch row layout: stacked rows <768px, table rows ≥768px
- Month group headers with transaction count
- Mobile filter: search bar + "Filter" button opening a bottom sheet
- Desktop filter: keep inline filter row
- Filter button shows a count badge when filters active

**Verification**:
- [ ] Tab loads `transactions.json` once; switching filters doesn't re-fetch
- [ ] Three most recent months show on first load
- [ ] "Load older" appends one month at a time
- [ ] Filtered view shows only months with matches; "Load older" skips empty months
- [ ] Search by "starbucks" filters live with ~100ms response
- [ ] On iPhone: filter button opens bottom sheet; in-sheet changes apply on dismiss
- [ ] Cross-tab linkout from Overview still pre-applies the month filter
- [ ] No Prev/Next buttons anywhere

**Out of scope**: Settings (M13). Final polish (M14).

---

## M13 — Settings sheet + persona switching mechanics

**Goal**: tapping the gear icon opens a Settings sheet with persona switcher + About. Switching personas re-renders the whole app against the new persona's JSON tree, no page reload.

**Scope**:
- Implement the Settings sheet content (PWA shell + feature spec):
  - "Active persona" section: two rows, one per persona, checkmark on active
  - About footer: app name + version + GitHub link
- Tapping a persona row: calls `setActivePersona(key)`, dismisses sheet
- `setActivePersona()` per engineering doc §4.2: writes to localStorage, calls `resetAndReload()`
- `resetAndReload()`: clear `_jsonCache`, reset all module state (lens, filters, focused month, tab — well, keep active tab), re-fetch + re-render the currently-visible tab
- Update the Overview persona caption when persona changes
- Default persona on first load: `student` (or whatever's first in `personas.json`)

**Verification**:
- [ ] Tapping gear → settings sheet opens
- [ ] Both personas listed, active one checked
- [ ] Tapping the other persona: sheet dismisses, app re-renders against the new persona's data
- [ ] Overview's persona caption updates to the new name
- [ ] Habits scope resets to "all spending"; Transactions filters clear; Overview shows the new persona's most recent month
- [ ] Reloading the page after switching: app remembers the active persona via localStorage
- [ ] No page reload happens during persona switch (verify via the Network tab — no `document` request)

**Out of scope**: install banner (M14).

---

## M14 — Install banner + final polish + ship

**Goal**: first-time iOS Safari visitors see a "Add to Home Screen" banner on their second visit. All deferred polish items resolved. Production deploy is the final v2 build.

**Scope**:
- Implement install banner per PWA shell doc §6: appears on visit 2+ for iOS Safari users not yet installed, with the Share → Add to Home Screen instructions
- Banner dismissal sets `localStorage.mh-install-dismissed = 'true'`
- Android `beforeinstallprompt` capture for the install-button variant on Android Chrome
- Visit counter increments on every load
- Test on real devices: iPhone (iOS Safari), iPad, Android Chrome, Mac Safari, desktop Chrome, desktop Edge
- Run through the full pre-launch verification checklist from PWA shell doc §9
- Run through all six success criteria from overview doc §5
- Final cleanup:
  - Delete `Procfile`
  - Delete `.active-dataset` if present (v1 file)
  - Archive `app.py` as a build-time-only file (or move to a `build/` folder with a clear name)
  - Remove the dev-mode URL shim from `app.js` (engineering doc §11.2)
  - Update `README.md` for v2 (new quickstart, deploy instructions)
  - Update `CLAUDE.md` to point at the v2 architecture
- Tag the v2 release in git

**Verification (the full overview-doc success criteria):**
- [ ] **Home-screen test**: iPhone install + chromeless launch + splash + dataset switcher discoverable
- [ ] **Subway test**: airplane mode + open app + last-cached tab renders + no broken state
- [ ] **Thumb test**: every control reachable one-handed on 390pt iPhone
- [ ] **Mac dock test**: install via Safari → Dock, launch in own window, desktop layout intact
- [ ] **Send-a-friend test**: open URL in iMessage, OG preview renders, friend can open + use without installing
- [ ] **30-day usage**: not verifiable at ship, but the bar is "five unprompted opens in 30 days"

**Out of scope**: nothing — this is ship. Anything not in this milestone gets logged for v2.1 or v3.

---

## Total estimated effort

The milestones above represent the full v2 build:

| Milestone | Estimated focused-work duration |
|---|---|
| M0 — Walking skeleton | 2 hours |
| M1 — Data layer refactor | 3 hours |
| M2 — Real build script + first persona | 4 hours |
| M3 — Second persona + personas.json | 1 hour |
| M4 — Asset pipeline | 3 hours |
| M5 — PWA manifest + meta | 2 hours |
| M6 — Service worker | 3 hours |
| M7 — `ios.js` primitives | 6 hours |
| M8 — Chart.js conversion | 6 hours |
| M9 — Custom radial chart | 4 hours |
| M10 — Navigation restructure | 5 hours |
| M11 — Overview + Habits restructure | 10 hours |
| M12 — Transactions restructure | 4 hours |
| M13 — Settings + persona switching | 3 hours |
| M14 — Install banner + polish + ship | 4 hours |
| **Total** | **~60 hours** |

That's roughly 7-8 full focused work days, or ~2-3 weeks part-time. Solo project, no team coordination overhead.

The estimates are deliberately conservative on the largest items (M7 ios.js primitives, M8 Chart.js conversion, M11 Overview + Habits restructure). Mobile design primitives and chart rewrites tend to expand on first contact with reality.

M11 specifically bundles two big tab restructurings (Overview and Habits). If it starts to feel too large mid-stream, the natural split is M11a (Overview restructure, ~4h) and M11b (Habits flyout + drill-down rearrangement, ~6h). The split is a tactical decision during execution; the doc doesn't pre-impose it.

---

## What's *not* in this phasing

A few things deliberately deferred to post-v2:

- **Real persona icon design**: M4 ships with a placeholder. The mark can be redesigned without rebuilding the pipeline.
- **Tailwind config refinement**: M11+ may introduce new utility classes. The Tailwind rebuild is a manual step (per existing convention) — not a milestone.
- **Performance profiling**: the initial build is fast enough; profile only if it slows down.
- **Bug fixes from real usage**: tracked separately as they arise during the 30-day usage period after M14.

---

## What happens after v2 ships

The deferred-to-future items from earlier docs:

- Dark mode (v3+)
- Push notifications (v3+, requires iOS 16.4+ standalone)
- Income vs. spending viz (revives the dormant `_df_full`)
- Real CSV upload (re-introduces a runtime backend — a real architecture shift)
- Multi-user / accounts / auth
- Additional personas
- Compare-month overlay in Habits drill-down
- Match highlighting in Transactions search
- The radial chart on mobile

None of these are blockers. v2 is a complete product on its own.
