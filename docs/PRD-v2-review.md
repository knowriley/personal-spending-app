# PRD v2 suite — systematic review

Cross-doc consistency review of all six PRDs. Findings are grouped by severity. Each finding lists where it is, what's wrong, why it matters, and a recommended fix.

The findings are not bugs in v2's design — they're places where the docs disagree with each other (because earlier decisions were revisited later), or places where a spec is incomplete enough that someone implementing it would have to guess.

---

## SEVERITY 1 — Will cause incorrect implementation if unresolved

### 1.1 The feature spec says the bottom tab bar is on every screen; every other doc says it's mobile-only

- **Where**: `PRD-v2-feature-spec.md` §1.1 (lines 19–21) says: *"Bottom tab bar on every screen replaces the current top secondary nav... The bottom tab bar is always visible..."*
- **What's right**: every other doc says bottom tab bar **mobile only**, with a **left side rail on desktop** (mobile design §2.1–2.2, engineering §6, phasing M10).
- **Why it matters**: this is the navigation pattern for the whole app. Whoever reads the feature spec first will build the wrong primary nav.
- **Fix**: rewrite feature spec §1.1 to match the mobile-design / engineering decision: bottom tab bar `<768px`, left side rail `≥768px`. Update the bullet about the brand wordmark (see Finding 1.2).

### 1.2 The brand wordmark's fate is contradictory and incomplete

- **Where**: 
  - `PRD-v2-feature-spec.md` §1.1 says the brand wordmark is **kept** as a passive element but loses its tap-to-home behavior.
  - `PRD-v2-mobile-design.md` never mentions a brand wordmark.
  - `PRD-v2-engineering.md` §6's `base.html` skeleton has no `<a id="brand-home-btn">` or equivalent.
- **What's right**: undecided. With a bottom tab bar (mobile) and a side rail (desktop), there's no obvious place for a brand wordmark anymore. The top of the mobile sticky header is occupied by the tab name + gear icon. The top of the side rail is the first tab cell.
- **Why it matters**: someone implementing the spec will have to invent where the brand mark goes, or silently drop it. Either way, the inconsistency is real.
- **Recommended fix**: drop the brand wordmark in v2. The app's identity is established by:
  - The home-screen icon (PWA shell)
  - The persona caption in Overview's eyebrow
  - The Settings sheet's About section (app name + version)
  - Direct text in the page header eyebrow when needed
  - That's enough.
  - Update feature spec §1.1 to say "the brand wordmark is removed in v2."

### 1.3 The persona caption format disagrees between docs

- **Where**:
  - `PRD-v2-feature-spec.md` §1.3 (line 42) shows `Looking at NYC Student` as a **separate line** above the H1 eyebrow (3-line header).
  - `PRD-v2-mobile-design.md` §1.3, §3.2, §5 all show `Overview · NYC Student` as the **condensed eyebrow** (2-line header).
  - `PRD-v2-phasing.md` M11 uses the condensed `Overview · NYC Student`.
- **What's right**: the condensed 2-line `Overview · NYC Student` is the decided form (you asked for it explicitly in the design conversation).
- **Why it matters**: the feature spec shows a 3-line ASCII layout that won't match the actual implementation.
- **Fix**: update feature spec §1.3 and the §2.2 ASCII layout to use the condensed form.

### 1.4 `scope_slug()` strips accented characters but the doc shows accents in filenames

- **Where**:
  - `PRD-v2-engineering.md` §3.5 defines `scope_slug()` with `re.sub(r"[^a-z0-9\-]", "", s)` — this strips the `é` from `Cafés`, producing slug `cafs`.
  - The example filename in §3.3 (`/api/student/category-detail-leaf-Cafés.json`) has the accent preserved.
- **What's right**: the function and the example disagree. If implemented literally, the filename would be `category-detail-leaf-cafs.json`.
- **Why it matters**: this is the *only* category with a non-ASCII character in the current dataset. If the slug strips it, the filename `cafs` is fine on disk but the frontend needs a deterministic way to compute it. If it doesn't strip it, the slug needs URL-safe encoding for the accent.
- **Recommended fix**: pick one approach and commit to it.
  - Option A: keep stripping accents (`scope_slug("Cafés")` → `cafs`). Update the example filename to match. Add a note that the frontend uses the same function via a shared `slug.js` helper imported by both Python and JS — OR the build emits a `slugs.json` manifest that the frontend reads.
  - Option B: preserve accents via `unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')` which transliterates `é` → `e`, giving `cafes` (better than `cafs`). Update the function. The example filename becomes `cafes`.
  - Option B reads more naturally — recommend.

### 1.5 The frontend has no specified way to compute category slugs

- **Where**: `PRD-v2-engineering.md` §3.5 defines `scope_slug()` in Python. §4 (frontend changes) never specifies how the frontend builds the equivalent URL.
- **Why it matters**: when the frontend wants to fetch `category-detail-leaf-cafes.json` for a user's clicked category, it needs to know the slug. The slug logic exists only in the build script.
- **Recommended fix**: pick one of:
  - Have the build emit `/api/{persona}/slugs.json` mapping `{category_name: slug}`. Frontend reads it once on init.
  - Write a JS equivalent of `scope_slug()` in `app.js` and trust both to stay in sync.
  - Embed the slug directly in `category-meta.json` (which already lists every category) so the frontend gets the slug at the same time it gets the category list.
- The third option is best — single source of truth, no duplication.

### 1.6 Engineering doc has two contradictory mechanisms for HTML templating

- **Where**: `PRD-v2-engineering.md` §3.5 (line 548) shows `render_index_html()` using `.replace("__BUILD_HASH__", ...)`. §6.1 (line 951) shows `render_index_html()` using Jinja `Environment` and says placeholders become Jinja vars `{{ BUILD_HASH }}`. The HTML skeleton in §6 (lines 882–924) uses `__BUILD_HASH__` syntax.
- **What's right**: undecided. The doc itself flags both options and "decides" on Jinja, but the example markup uses `.replace()`-style placeholders.
- **Why it matters**: Claude executing this will pick one or do both inconsistently. If the Jinja approach is chosen, the existing `__BUILD_HASH__` placeholders in `base.html` won't be replaced — they have to be rewritten as `{{ BUILD_HASH }}`.
- **Recommended fix**: pick one, update all examples.
  - Recommend: **use Jinja `Environment`**. It handles the `{% extends "base.html" %}` + `{% block content %}` inheritance correctly without manual concatenation. Update all `__BUILD_HASH__` and `__DEPLOY_URL__` references in templates to `{{ BUILD_HASH }}` and `{{ DEPLOY_URL }}`.
  - Use `.replace()` only for the service worker and manifest JSON, which aren't Jinja templates.

---

## SEVERITY 2 — Will cause confusion or rework, but won't break the build

### 2.1 PWA shell doc was written before the Chart.js local-copy decision

- **Where**:
  - `PRD-v2-pwa-shell.md` §5.3 SHELL_URLS list includes `https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js` with a `// or local copy` comment.
  - §8 has `<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>` and a description that says "Chart.js's initial connection cost on the first load. After the SW caches it, the preconnect is harmless."
  - §10 lists "Whether Chart.js is loaded from CDN or shipped as a local copy" as an open engineering question.
- **What's right**: engineering doc resolved this — **local copy**. PWA shell is stale.
- **Fix**: 
  - Update SHELL_URLS to use `/static/js/chart.umd.min.js` (local path).
  - Remove the `<link rel="preconnect">` to jsdelivr — pointless if the file is local.
  - Update §10 to remove the now-resolved question.

### 2.2 Overview doc §7 still lists "where the dataset switcher lives" as open

- **Where**: `PRD-v2-overview.md` §7 (line 99) says: *"Where does the dataset switcher live on a phone? Currently top-right of the desktop header. On phone, top-right is precious territory and there's no header bar. Settings sheet? A header strip inside the active tab? A long-press on the brand mark? → mobile design doc."*
- **What's right**: resolved — gear icon → Settings sheet, on every screen. (Feature spec §5, engineering doc, mobile design doc, phasing M13 all agree.)
- **Why it matters**: someone reading the overview doc first will look for the answer in the mobile design doc, which mentions it but doesn't lead with it. The overview should reflect resolved decisions.
- **Fix**: move this question from §7 (Still-open) to §6 (Resolved decisions). New entry: *"Dataset switcher: gear icon top-right on mobile sticky header / bottom of side rail on desktop, opens a Settings sheet with persona switcher + About footer."*

### 2.3 Feature spec §5.1 says gear icon is top-right on every screen, contradicting the side rail decision

- **Where**: `PRD-v2-feature-spec.md` §5.1 (line 394): *"A gear icon (⚙) in the **top-right of the page header on every tab and every screen**."*
- **What's right**: mobile design §2.2 says **bottom of the side rail on desktop**. Phasing M10 also says bottom of side rail.
- **Why it matters**: same as Finding 1.1 — primary navigation contradiction.
- **Fix**: rewrite the bolded phrase as: "in the top-right of the sticky header on mobile; at the bottom of the side rail on desktop."

### 2.4 Phasing M6 cross-references install banner as M11, but it's actually M14

- **Where**: `PRD-v2-phasing.md` M6 (line 178): *"Out of scope: the install banner (M11)."* The install banner is in M14.
- **Fix**: change `M11` to `M14`.

### 2.5 Engineering doc Mode A (dev mode against v1 Flask) is incompletely specified

- **Where**: `PRD-v2-engineering.md` §11.2 describes a "dev-mode shim" that redirects v2-style URLs (`/api/student/summary-all-last-12-months.json`) to v1-style endpoints (`/api/summary?persona=...&level=all&...`). Estimated at ~30 LOC.
- **What's actually true**: the shim would need a complete mapping table for every endpoint, would need to handle the v1→v2 endpoint name changes (`/api/datasets` → `personas.json`, etc.), and would need v1 Flask to also serve `index.html` in the v2-shaped layout. The actual implementation is much more than 30 LOC and would rot.
- **Why it matters**: someone trying to use Mode A during development will hit walls. Mode B (full build, then `python -m http.server`) is the simpler honest answer.
- **Recommended fix**: drop Mode A from the doc. Replace §11.2 with: *"Dev flow: `python build_static.py && cd dist && python -m http.server 8000`. Re-run `build_static.py` after changes. Build is fast (~30–60s) and the iteration overhead is acceptable for a solo project. If iteration speed becomes a pain point, add a file watcher in v2.1."*

### 2.6 Categories file naming uses shortened form but doc shows v1 path as comment

- **Where**: `PRD-v2-engineering.md` §3.3 shows `// /api/student/categories.json` but the v1 endpoint is `/api/categories/list`. The file is `categories.json`, not `categories-list.json`.
- **Why it matters**: minor, but the comment-vs-filename mismatch will confuse someone reading the doc.
- **Fix**: change the comment to match the filename: `// /api/student/categories.json (replaces v1's /api/categories/list)`.

### 2.7 M11 effort estimate is optimistic relative to scope

- **Where**: `PRD-v2-phasing.md` lists M11 at 6 hours. M11 contains: Overview restructure (delete 2 cards, restructure 1 card, reposition 1 card, replace dual-line chart with toggle, bottom-sheet month picker, persona caption) + Habits restructure (delete KPI strip, delete always-rendered drill-down, wire flyout, build daily-totals strip, relocate pie toggle).
- **Why it matters**: at 6 hours this is the same effort as M7 (ios.js primitives, ~6 functions) or M8 (Chart.js conversion, ~6 chart rewrites). M11 has more discrete tasks than either.
- **Recommended fix**: either bump M11 to 8–10 hours, OR split it: M11a (Overview restructure, 4h), M11b (Habits flyout, 4h).

---

## SEVERITY 3 — Worth noting but not necessarily worth fixing

### 3.1 Several "live demo" / example values in the engineering doc are aspirational

- **Where**: `PRD-v2-engineering.md` shows estimates like `~3,600 rows × ~200 bytes = ~700KB`. The actual rows-per-persona is 3,624 (per DATA-PIPELINE.md). The estimates are close enough but slightly off.
- **Why it matters**: numbers will be slightly different at build time. Not an execution problem.
- **Fix**: optional. Leave the estimates as ballpark figures.

### 3.2 The radial chart specification doesn't mention click hit-testing precision

- **Where**: `PRD-v2-engineering.md` §7.5 describes 12 month-sector hit targets but doesn't say how big each sector's hit area is (does it span all radii, or only "within the ring"?).
- **Why it matters**: the implementation will work either way, but the UX feel will differ. Wide hit areas (entire sector from center to outer ring) are more forgiving but might miss the user's intent if they're trying to click a specific year's ring.
- **Fix**: clarify §7.5: *"Hit target spans the entire month sector (center to outer ring) at the wedge-shaped slice. A click anywhere in the sector triggers `onMonthClick` for the currently-active year (most-recent visible year by default; pinned year overrides)."*

### 3.3 The Habits drill-down flyout's effect on the page's scroll position is unspecified

- **Where**: feature spec and mobile design both describe the flyout opening but don't say what happens to the underlying Trends page's scroll position when the flyout dismisses. Should it return to where the user was, or reset?
- **Why it matters**: minor UX detail. iOS-native push transitions preserve underlying scroll. Web equivalents sometimes don't.
- **Fix**: add to mobile design §4.3: *"When the flyout dismisses, the underlying Trends page's scroll position is preserved. The user returns to exactly where they were."*

### 3.4 SF Pro font on Android falls back to platform default (Roboto) — visual disparity unaddressed

- **Where**: `PRD-v2-mobile-design.md` §1.2 spec'd the SF stack with `system-ui, sans-serif` fallback. Android users won't get San Francisco.
- **Why it matters**: on Android, the app will look subtly different (Roboto numerals vs. SF numerals). Not broken, just not "iOS feel" for Android users.
- **Worth noting**: you're single user and use iOS. This is fine. But worth knowing that the "send a friend the link" success criterion involves an Android friend potentially seeing Roboto. If that matters, consider shipping an SF Pro web font (~200KB extra) for parity.

### 3.5 Service worker doesn't handle navigation requests for hash-based routes

- **Where**: `PRD-v2-engineering.md` §8 SW fetch handler routes `navigate` mode to cache-first `/`. But `app.js` uses `#overview` / `#habits` / `#transactions` for browser back-button — these are all the same URL from the SW's perspective.
- **Why it matters**: the SW behavior is actually correct (the hash is client-side only, the SW serves `/` for all navigations). Just worth confirming that this is intentional, not accidental.
- **Worth noting**: the doc could state this explicitly: *"Hash-based routing means every navigation resolves to `/`; the SW always serves the app shell, and `app.js` reads `window.location.hash` to pick the initial tab."*

---

## What's NOT a problem

Things I checked that turned out fine:

- **Plotly references** — all appropriate as "removed from v1" or "replaced by Chart.js" context.
- **Viewport meta tag** — `viewport-fit=cover, user-scalable=no` is consistent across docs.
- **Safe-area handling** — consistent (mobile design §1.7).
- **Border radii ramp** — mobile design §1.5 is the source of truth, nothing else specifies it.
- **Service worker cache versioning** — `moneyhabits-shell-${BUILD_HASH}` is consistent.
- **Single-detent modal sheets** — consistent everywhere.
- **Right flyout dismissal options** (tap-outside-desktop / X / swipe-right) — consistent.
- **Milestone numbering and total estimate (~56h)** — internally consistent. Only the M11 estimate is questionable.

---

## Recommended order for fixing the SEV-1 issues

If you're going to fix the inconsistencies before handing the suite to Claude for implementation, do them in this order:

1. **Fix Finding 1.6 first** (HTML template substitution mechanism) — every other doc references the build pipeline; pick Jinja or `.replace()` before anyone writes templating code.
2. **Fix Finding 1.4 + 1.5 together** (slug strategy + frontend slug computation) — these are the same problem with two facets.
3. **Fix Finding 1.1** (feature spec nav contradiction) — high read-priority doc.
4. **Fix Finding 1.2** (brand wordmark) — small but affects the `base.html` skeleton.
5. **Fix Finding 1.3** (persona caption format) — small.

SEV-2 fixes are cleanup that can happen as the docs are revisited during implementation; they won't actively break anything.

SEV-3 items can stay as-is.

---

## Summary

| Severity | Count | Risk if unresolved |
|---|---|---|
| 1 | 6 | Incorrect implementation |
| 2 | 7 | Confusion, rework |
| 3 | 5 | Minor / informational |

Six SEV-1 findings is more than I'd hoped to find. The good news: they're all concentrated in two areas (the nav/header decisions, which evolved late, and the build pipeline's templating + slug story, which is the newest material in the suite). The pattern is "decisions made later in the conversation didn't get retroactively applied to docs written earlier."

The fixes are small. None of them require new decisions — every SEV-1 has a clear resolution that's already been decided elsewhere in the suite. They're just cleanup work.

If you want, I can apply the SEV-1 fixes now in a follow-up turn.
