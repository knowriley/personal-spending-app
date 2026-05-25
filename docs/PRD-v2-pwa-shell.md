# PRD v2: PWA shell

> Scope: what makes MoneyHabits installable, chromeless, offline-resilient, and icon-on-home-screen.
> Companion docs: `PRD-v2-overview.md` anchors the suite, `PRD-v2-feature-spec.md` and `PRD-v2-mobile-design.md` define the in-app experience, `PRD-v2-engineering.md` covers the build pipeline.
> Reading order: this doc → engineering → phasing.

This is the doc that makes a Flask-app-becomes-static-site feel like a real iOS app. Most of it is mechanical (manifest entries, icon sizes, head tags), but the choices have real consequences for the "feels installed" goal.

A single guiding constraint: **iOS is the strictest platform we target**. Android handles PWAs more flexibly, Chrome/Edge desktop install behavior is well-defined, but iOS requires per-device splash screens, a specific meta tag dance, and a manual install flow. If we get iOS right, the others follow.

---

## 1. Web app manifest

A single `manifest.json` at the site root. Served with `Content-Type: application/manifest+json`.

### 1.1 Required fields

```json
{
  "name": "MoneyHabits",
  "short_name": "MoneyHabits",
  "description": "A personal finance dashboard for tracking spending habits.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#ffffff",
  "theme_color": "#4338ca",
  "lang": "en-US",
  "categories": ["finance", "productivity"],
  "icons": [ /* see §2 */ ]
}
```

### 1.2 Field-by-field reasoning

| Field | Value | Why |
|---|---|---|
| `name` | `MoneyHabits` | Shows in the install dialog, in the app switcher on Android, and in some places on desktop |
| `short_name` | `MoneyHabits` | Shows under the home-screen icon on iOS and Android. Same as `name` since it's already short. iOS truncates at ~12 characters; "MoneyHabits" is 11. |
| `description` | One sentence | Used by some browsers in install prompts and app stores (PWA-listed app stores like the Microsoft Store) |
| `start_url` | `/` | Opens to Overview (the home tab). Tracking params (`?utm_source=homescreen`) can be added later if we want install attribution. |
| `scope` | `/` | All navigation within `/` stays inside the installed app. Out-of-scope links open in Safari. The entire site is in scope. |
| `display` | `standalone` | Chromeless launch — no Safari URL bar, no tab strip. This is what makes it "feel like an app." |
| `orientation` | `portrait-primary` | The design is portrait-first. Landscape is unsupported in v2. iOS rotates the lock screen but the PWA stays portrait. |
| `background_color` | `#ffffff` | Used by the OS during launch before the splash image loads. Matches the app's white background. |
| `theme_color` | `#4338ca` | Tailwind `indigo-700` (the `--color-accent-700` token). On Android, this colors the status bar. On iOS in standalone mode, the status bar takes its color from the `apple-mobile-web-app-status-bar-style` meta tag, not this — but it's good practice to include. |
| `lang` | `en-US` | English only in v2 |
| `categories` | `["finance", "productivity"]` | Used by PWA directories that index installable apps |

### 1.3 What's not in the manifest

- No `screenshots` array — those are for app-store-like listings; not needed for a personal-use PWA.
- No `shortcuts` array — iOS Long-Press home screen shortcuts on PWAs are limited; defer to v3 if useful.
- No `share_target` — we're not receiving shared content from other apps.
- No `protocol_handlers` — same reason.

---

## 2. Icon set

The PWA needs square icons at several sizes across iOS, Android, and macOS. The v2 icon is **wordmark-based** — a stylized `M` or `MH` mark, designed as one SVG source that exports to all required raster sizes.

### 2.1 Source asset

A single `static/icons/source.svg`: a 512×512 square with the `M` (or `MH`) mark centered on a brand-colored background (`accent-700` indigo). Border radius is NOT included in the source — iOS/macOS apply their own corner-rounding to icons. The source is a flat square.

The design itself (typography, exact mark form, weight, kerning of `MH` if used) is design work outside this PRD's scope. The constraint is: must read clearly at 60×60pt (the smallest required iOS size).

### 2.2 Manifest icons array

```json
"icons": [
  { "src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "/static/icons/icon-192-maskable.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
  { "src": "/static/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

The 192px and 512px sizes are the **W3C-recommended baseline**. The 512px version is also used by Android as the source for any other sizes it needs.

`purpose: "maskable"` icons have the mark centered in the inner ~80% of the canvas (the "safe zone"), allowing Android to apply different masks (squircle, circle, rounded square) without clipping the mark.

### 2.3 iOS-specific icons

iOS does NOT read PWA icons from the manifest. It reads them from `<link rel="apple-touch-icon">` tags in the HTML head (§4). The icon sizes iOS expects:

| Size | Used for |
|---|---|
| 180×180 | iPhone home screen (`@3x` devices — 14/15 series and most current iPhones) |
| 167×167 | iPad Pro home screen |
| 152×152 | iPad home screen |
| 120×120 | iPhone home screen (`@2x` devices — older iPhones) |

In practice, iOS will scale the 180×180 down for older devices, but providing dedicated assets avoids any quality loss. v2 ships all four.

### 2.4 macOS dock icon

macOS in standalone PWA mode (added to dock) uses the manifest's 512×512 icon. No additional file needed.

### 2.5 Generation pipeline

All raster icons are generated from `source.svg` via a build script (engineering doc spec'd this). A single `npm` script or Python script using `cairosvg` or similar exports the full set on each build. This guarantees consistency — change the source once, all sizes update.

The generated files:
```
/static/icons/
  source.svg                  ← single source of truth
  icon-120.png                ← iOS @2x iPhone
  icon-152.png                ← iPad
  icon-167.png                ← iPad Pro
  icon-180.png                ← iOS @3x iPhone (primary iOS asset)
  icon-192.png                ← W3C manifest baseline
  icon-512.png                ← W3C manifest, macOS dock
  icon-192-maskable.png       ← Android adaptive icon
  icon-512-maskable.png       ← Android adaptive icon
  favicon.ico                 ← classic browser favicon (32x32 multi-resolution)
  favicon-16.png              ← desktop browser tab
  favicon-32.png              ← desktop browser tab
```

11 files total, all derived from one SVG.

---

## 3. iOS splash screens

iOS does not generate splash screens from the manifest. For chromeless PWAs, the OS shows whatever PNG matches the device's pixel-ratio + orientation media query at launch.

### 3.1 Design

A single SVG source (`static/splash/source.svg`) — a 1290×2796 canvas (the largest target), white background, with the wordmark/icon mark centered in the upper-middle third. The splash is the **same visual language as the app's launch state**: white background, brand mark, no chrome.

Why upper-middle third: at smaller phone screens, the mark stays in the optical center; at larger screens, the mark sits above the lower 40% which often hosts content or interactions.

### 3.2 Required splash sizes

iOS device targets that matter as of 2026:

| Device class | Resolution | `media` query |
|---|---|---|
| iPhone 15/14/13 Pro Max, Plus | 1290×2796 | `(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)` |
| iPhone 15/14 Pro | 1206×2622 | `(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)` |
| iPhone 15/14/13 standard | 1170×2532 | `(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)` |
| iPhone 13/12 mini | 1080×2340 | `(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)` |
| iPhone SE/8/7/6s | 750×1334 | `(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)` |
| iPad Pro 12.9" | 2048×2732 | `(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)` |
| iPad Pro 11" / iPad Air | 1668×2388 | `(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)` |
| iPad standard | 1620×2160 | `(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)` |
| iPad mini | 1488×2266 | `(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)` |

Nine targets total. All in portrait orientation (the manifest's `portrait-primary` orientation lock means landscape splashes are never shown).

### 3.3 Generation pipeline

Same approach as icons — a build script renders all 9 PNGs from the source SVG. Each PNG is positioned identically (the mark in the upper-middle third) regardless of the device aspect ratio.

The generated files:
```
/static/splash/
  source.svg
  splash-1290x2796.png
  splash-1206x2622.png
  splash-1170x2532.png
  splash-1080x2340.png
  splash-750x1334.png
  splash-2048x2732.png
  splash-1668x2388.png
  splash-1620x2160.png
  splash-1488x2266.png
```

### 3.4 HTML head tags

The full set of `<link rel="apple-touch-startup-image">` tags is added to `<head>` (§4). One tag per splash file, each with its precise media query.

---

## 4. HTML head meta

The `<head>` in `base.html` gains a meaningful collection of meta tags to make the PWA install correctly. Full set:

```html
<!-- Standard meta -->
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>MoneyHabits</title>
<meta name="description" content="A personal finance dashboard for tracking spending habits.">

<!-- Theme color -->
<meta name="theme-color" content="#ffffff">

<!-- Web app manifest -->
<link rel="manifest" href="/manifest.json">

<!-- Open Graph (link previews in iMessage, Twitter, Slack, etc.) -->
<meta property="og:type" content="website">
<meta property="og:title" content="MoneyHabits">
<meta property="og:description" content="A personal finance dashboard for tracking spending habits.">
<meta property="og:image" content="https://[deploy-url]/static/icons/icon-512.png">
<meta property="og:url" content="https://[deploy-url]/">

<!-- iOS PWA specific -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="MoneyHabits">
<meta name="format-detection" content="telephone=no">

<!-- iOS touch icons (one per size) -->
<link rel="apple-touch-icon" sizes="180x180" href="/static/icons/icon-180.png">
<link rel="apple-touch-icon" sizes="167x167" href="/static/icons/icon-167.png">
<link rel="apple-touch-icon" sizes="152x152" href="/static/icons/icon-152.png">
<link rel="apple-touch-icon" sizes="120x120" href="/static/icons/icon-120.png">

<!-- Standard favicon -->
<link rel="icon" type="image/png" sizes="32x32" href="/static/icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/static/icons/favicon-16.png">
<link rel="shortcut icon" href="/favicon.ico">

<!-- iOS splash screens -->
<link rel="apple-touch-startup-image" href="/static/splash/splash-1290x2796.png"
  media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
<link rel="apple-touch-startup-image" href="/static/splash/splash-1206x2622.png"
  media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
<link rel="apple-touch-startup-image" href="/static/splash/splash-1170x2532.png"
  media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
<link rel="apple-touch-startup-image" href="/static/splash/splash-1080x2340.png"
  media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)">
<link rel="apple-touch-startup-image" href="/static/splash/splash-750x1334.png"
  media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
<link rel="apple-touch-startup-image" href="/static/splash/splash-2048x2732.png"
  media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
<link rel="apple-touch-startup-image" href="/static/splash/splash-1668x2388.png"
  media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
<link rel="apple-touch-startup-image" href="/static/splash/splash-1620x2160.png"
  media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
<link rel="apple-touch-startup-image" href="/static/splash/splash-1488x2266.png"
  media="(device-width: 744px) and (device-height: 1133px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)">
```

### 4.1 Notes on each meta tag

- **`viewport`**: `viewport-fit=cover` is required for the `env(safe-area-inset-*)` CSS variables to resolve. `user-scalable=no` prevents accidental pinch-zoom (the design system already handles zoom via font sizing).
- **`theme-color`**: white because the app surface is white. On iOS in standalone mode, the status bar reads from `apple-mobile-web-app-status-bar-style`, not this — but Chrome on Android uses this value for the navigation bar.
- **`apple-mobile-web-app-capable: yes`**: the magic flag that tells iOS "this is a PWA, use standalone display mode when added to home screen." Without this, tapping the home-screen icon launches the URL in Safari, not in a chromeless window.
- **`apple-mobile-web-app-status-bar-style: default`**: black text on white background. On iOS, the alternatives are `black` (white text, dark bar) and `black-translucent` (white text overlaid on content, which we don't want). `default` matches the app's white background and dark text.
- **`apple-mobile-web-app-title: MoneyHabits`**: the label under the home-screen icon. Matches `short_name` in the manifest. iOS reads this tag specifically, not the manifest.
- **`format-detection: telephone=no`**: prevents iOS from auto-linking numbers in transaction amounts as phone numbers (a real issue with dollar values).

### 4.2 What's deliberately not in head

- No Twitter-card-specific tags (`twitter:card`, `twitter:image`) — Twitter falls back to OG tags correctly, no extra tags needed.
- No `<link rel="canonical">` — single-URL app, no canonical question.
- No `<script>` tags for analytics — out of scope for v2.

### 4.3 The OG image URL caveat

The `og:image` and `og:url` properties require an **absolute URL** — relative paths don't render correctly in link-preview contexts (Slack and iMessage both ignore relative `og:image` values). The build pipeline must substitute `[deploy-url]` with the actual Render-served origin at deploy time.

Engineering doc specifies the substitution mechanism — likely a build-time env var (`DEPLOY_URL`) injected into `base.html` during the static-site build.

---

## 5. Service worker

A single service worker at `/service-worker.js`, registered from `app.js` on page load.

### 5.1 Caching strategy (recap)

Decided earlier in the suite:

| Resource type | Strategy | Rationale |
|---|---|---|
| App shell (HTML, CSS, app.js, radial.js, ios.js) | Cache-first with version bump | Changes only on deploy; cold-launch performance |
| Chart.js (local copy in `/static/js/`) | Cache-first | ~200KB, never changes between builds; bundled at deploy time |
| Icons + splash screens | Cache-first | Never change between builds; expensive to redownload |
| Pre-computed JSON (`/api/*.json`) | Stale-while-revalidate | Fresh on revisit, instant on launch |
| Persona dataset assets | Stale-while-revalidate | Same as above |
| The manifest itself | Network-first, fallback to cache | Lets browsers update install metadata quickly |
| Service worker file itself | Browser-managed (`updateViaCache: 'none'`) | Critical for the silent-update story |

### 5.2 Cache structure

Two named caches, both keyed by build hash:

```js
const BUILD_HASH = '__BUILD_HASH__';   // replaced at build time
const SHELL_CACHE = `moneyhabits-shell-${BUILD_HASH}`;
const DATA_CACHE  = `moneyhabits-data-${BUILD_HASH}`;
```

The build hash is a short string (8 chars of a git SHA or a timestamp-derived hash). Engineering doc specifies how it's injected at build time.

### 5.3 Install + activate lifecycle

**Install event:** precaches the app shell. The list of shell URLs is generated at build time and embedded into the service worker:

```js
const SHELL_URLS = [
  '/',
  '/static/css/style.css',
  '/static/css/tailwind.css',
  '/static/js/app.js',
  '/static/js/radial.js',
  '/static/js/ios.js',
  '/static/js/chart.umd.min.js',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/icon-180.png',
  // … all icons, all splash screens
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS))
  );
});
```

**Activate event:** deletes old caches (any cache whose name doesn't end in the current `BUILD_HASH`). This is what makes deploys clean.

```js
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !k.endsWith(BUILD_HASH)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});
```

### 5.4 Fetch event — the routing logic

```js
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Shell asset → cache-first
  if (SHELL_URLS.includes(url.pathname) || url.pathname.startsWith('/static/')) {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Pre-computed JSON → stale-while-revalidate
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileRevalidate(event.request, DATA_CACHE));
    return;
  }

  // Navigations (HTML) → cache-first to the app shell
  if (event.request.mode === 'navigate') {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  // Default: network, no caching
});
```

The `cacheFirst` and `staleWhileRevalidate` functions are ~10 LOC each — standard SW patterns.

### 5.5 Offline behavior

- **App shell offline**: full app loads from cache. Tab navigation works.
- **JSON data offline**: stale-while-revalidate falls back to cached data if network fails. The user sees the last-cached state.
- **No cached data at all** (e.g., first ever launch with no network): the JSON fetch fails. The frontend renders an empty-state "Couldn't load data. Connect to the network and try again." card on each tab.
- **Persona switching offline**: if the target persona's JSON is in cache (user has visited it before), instant switch. If not, the same empty-state card.

There is no separate `/offline.html` page — the app shell itself is the offline experience.

### 5.6 Update strategy (silent)

When a new build deploys:

1. The browser fetches the new service worker file (which now has a different `BUILD_HASH`).
2. The new SW installs in the background, pre-caching the new shell URLs.
3. The new SW enters the "waiting" state — the current page is still controlled by the old SW.
4. When the user closes all tabs of the PWA and re-opens, the new SW activates and serves the new build.

No prompts, no toasts. The user gets the update on next session.

The `self.skipWaiting()` call is deliberately **not** used — that would force the new SW to activate immediately, mid-session, which can break in-flight requests and cached state. The user-friendly behavior is to wait for the next session.

### 5.7 Service worker registration

In `app.js`, near the top:

```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .catch(err => console.error('SW registration failed:', err));
  });
}
```

No update prompts. No console logging on success. Failure is logged but doesn't surface to the user.

---

## 6. Install banner

iOS does not support `beforeinstallprompt`. The only way for iOS users to install a PWA is through Safari's Share menu → "Add to Home Screen." This is undiscoverable. v2 ships a first-visit banner to guide the user.

### 6.1 When the banner appears

The banner appears only when **all** of the following are true:

- User is on iOS Safari (UA sniff: `iPhone|iPad|iPod` and `Safari` in UA but NOT `CriOS|FxiOS|EdgiOS`)
- The app is NOT already running in standalone mode (`window.navigator.standalone === false` on iOS)
- The user has NOT previously dismissed the banner (`localStorage.getItem('mh-install-dismissed') !== 'true'`)
- This is at least the user's second visit (`localStorage.getItem('mh-visit-count') >= 2`)

The second-visit gate avoids interrupting a first-time visitor who's still figuring out what the app is. By the second visit, they've committed; offering to install makes sense.

### 6.2 Visual design

The banner sits at the bottom of the viewport, above the tab bar:

```
┌──────────────────────────────────────┐
│                                      │
│        [page content]                │
│                                      │
├──────────────────────────────────────┤
│ [icon]  Install MoneyHabits          │  ← banner
│         Tap Share → Add to Home      │
│         Screen for the full app.     │
│                                  ✕   │
├──────────────────────────────────────┤
│  [tab bar]                           │
└──────────────────────────────────────┘
```

- **Container**: opaque white, 1px top border `gray-200`, full width, `px-4 py-3`. Sits above the tab bar — but does NOT replace it.
- **Icon**: a small (32×32pt) MoneyHabits icon thumbnail
- **Title**: `text-base font-semibold text-neutral-900`
- **Subtitle**: `text-sm text-neutral-600`
- **Close button (X)**: 24×24pt top-right, `text-neutral-500`. Tap to dismiss.
- **Animation on appear**: slides up from below the tab bar (300ms, iOS easing)

The banner is dismissable. Tapping X sets `localStorage.setItem('mh-install-dismissed', 'true')` — never shown again on this device.

### 6.3 Subtitle copy variation

The subtitle includes a small inline `↑` arrow pointing to the Share button location in Safari (top toolbar on iPhone). This is rendered as a Unicode arrow inline with the text rather than as an animated graphic — the goal is to be helpful, not gimmicky.

Full copy: `Tap` `[Share icon SVG]` `then "Add to Home Screen" for the full app.`

The Share icon is a small (16×16pt) inline SVG rendering of the iOS Share glyph (a square with an arrow pointing up).

### 6.4 Android equivalence

Android Chrome supports `beforeinstallprompt`. When that event fires, we capture it and substitute the install banner with a "Tap to install" button instead of the manual instructions:

```js
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  // Render banner with "Install" button instead of "Tap Share" instructions
});
```

Same dismissal rules apply.

### 6.5 Desktop install (Chrome, Edge)

Desktop Chrome and Edge support manifest-based install. The browser shows its own install icon in the URL bar. v2 does NOT show the install banner on desktop — the browser's native affordance is sufficient. The banner is mobile-only.

### 6.6 What happens after install

When the user installs and re-opens MoneyHabits from the home screen, `window.navigator.standalone === true` on iOS (or `display-mode: standalone` matches on Android). The banner-display check fails on the first condition, so it never appears in the installed app.

### 6.7 First-visit visit counter

`localStorage.setItem('mh-visit-count', (Number(localStorage.getItem('mh-visit-count') || 0)) + 1)` runs on every app load. Cheap, accurate enough.

---

## 7. Permissions and capabilities

v2 requests **no permissions**. No notifications, no geolocation, no clipboard access, no file system access. The PWA runs entirely on what the user can see and tap.

Future versions may want notification permission (e.g., for monthly spending recap), but iOS PWA push notifications require iOS 16.4+ AND home-screen installation, and the API is still maturing. Defer to v3+.

---

## 8. Asset preloading and resource hints

The `<head>` includes a small set of preload hints to speed up the critical render path:

```html
<link rel="preload" as="style" href="/static/css/style.css">
<link rel="preload" as="style" href="/static/css/tailwind.css">
<link rel="preload" as="script" href="/static/js/app.js">
```

No `preconnect` is needed — every asset is self-hosted under `/static/`. No `preload as="font"` either — system fonts (SF stack) don't need preloading.

---

## 9. Testing the PWA

Pre-launch verification checklist (the doc gives the "what"; engineering doc gives the "how"):

- [ ] Manifest passes the W3C manifest validator
- [ ] All 9 splash screen media queries resolve correctly on the listed devices (use Safari's device-emulation mode or actual hardware)
- [ ] `apple-mobile-web-app-capable=yes` confirmed via "Add to Home Screen" launching in standalone mode (no Safari chrome)
- [ ] App icon appears correctly on home screen at all device sizes (no fuzzy edges, no auto-applied rounded corners breaking the design)
- [ ] Service worker passes Lighthouse PWA audit (all green)
- [ ] Offline behavior verified: launch app, enable airplane mode, navigate all tabs, switch personas (if cached). Expected: no errors, last-cached state visible.
- [ ] Install banner appears only on second iOS visit, dismisses correctly, never reappears after dismissal
- [ ] After installation, banner doesn't show in the installed app
- [ ] After a deploy, the next session shows the new build (silent update verified)

---

## 10. What this doc deliberately leaves to engineering

- The exact build script that generates icons, splash screens, and `BUILD_HASH` injection
- The mechanics of how `BUILD_HASH` gets injected into the service worker source at build time
- The exact `cacheFirst` and `staleWhileRevalidate` helper implementations
- Render's static-site configuration (which paths are served, how `manifest.json` gets its MIME type set, how the service worker scope is enforced)
- The `[deploy-url]` substitution mechanism for `og:image` and `og:url` (likely a build-time env var injected into `base.html`)

These all land in `PRD-v2-engineering.md`.
