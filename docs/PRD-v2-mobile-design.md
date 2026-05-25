# PRD v2: Mobile design

> Scope: pixel-level specs for v2. Translates the feature-spec behavioral decisions into typography, spacing, animation, and component specifications.
> Companion docs: `PRD-v2-overview.md` anchors the suite, `PRD-v2-feature-spec.md` is the behavioral source-of-truth this doc implements, `PRD-v2-pwa-shell.md` covers icon and splash assets, `PRD-v2-engineering.md` covers the build pipeline.
> Reading order: this doc → PWA shell → engineering → phasing.

This is the densest doc in the suite. It's structured in nine sections, foundational sections first. A new contributor — human or Claude — should be able to read sections 1–4 before any per-tab work, then dip into 5–9 as needed.

A guiding principle from the feature spec applies throughout: **unified layout, one component scales up.** When mobile and desktop need different patterns (left rail vs. bottom tab bar, inline filter vs. sheet filter), the difference is called out explicitly. Default is "same thing, different breakpoint."

---

## 1. Foundations

### 1.1 Viewport targets

- **Mobile design target**: iPhone 14/15/16 (390pt wide × 844pt tall). Designs read well from 375pt (mini/SE) up to 430pt (Pro Max) without breaking; 390pt is the canonical reference.
- **Desktop**: ≥768px (the `md:` breakpoint in Tailwind). The existing `max-w-6xl` outer container is preserved.
- **Breakpoint**: a single `md:` (768px) breakpoint flips mobile patterns (bottom tab bar, sheet filters, stacked rows) into desktop patterns (left rail, inline filters, table rows). No intermediate tablet stage.

### 1.2 Typography — SF stack

The base font stack switches from Inter to the SF stack on **every screen**, mobile and desktop:

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "SF Pro Display",
  "SF Pro Text",
  system-ui,
  sans-serif;
```

This means:
- iOS devices get genuine San Francisco
- macOS browsers get genuine San Francisco
- Windows / Android / Linux fall back through `system-ui` to platform-appropriate defaults
- No Inter at all in v2 — the existing `<link>` import in `base.html` is removed

Numerals continue to use `tabular-nums` for dollar amounts (Tailwind utility already in use). The SF stack provides genuine proportional + tabular sets natively, no extra config needed.

### 1.3 Type scale (mobile + desktop unified)

Same scale at every viewport. The large-title pattern (§3.2) handles the "huge title on phone" feeling, so the underlying tokens stay consistent.

| Use | Class | Px | Notes |
|---|---|---|---|
| Large-title (initial state) | `text-4xl font-bold tracking-tight text-neutral-900` | 36 | iOS large-title equivalent |
| Page title (sticky state / H1) | `text-2xl font-semibold tracking-tight text-neutral-900` | 24 | What the large-title shrinks into |
| Eyebrow | `text-sm font-medium text-neutral-500` | 14 | Above the H1 (e.g., `Overview · NYC Student`) |
| Card label | `text-base font-semibold text-neutral-900` | 16 | Unchanged from v1 |
| Card value (hero number) | `text-6xl font-semibold tracking-tight text-neutral-900` | 60 | Overview card 1 keeps this |
| Section header (month group header in Transactions) | `text-base font-semibold text-neutral-600` | 16 | New in v2 |
| Body text | `text-sm text-neutral-700` | 14 | |
| Caption (transaction date, "X transactions") | `text-xs text-neutral-500` | 12 | |
| Tab bar / rail label | `text-xs font-medium` | 11–12 | Below icon, active in `accent-700` |

The v1 design system's scale was already narrow; v2 swaps a few values and adds the large-title token. Most existing utility usage carries over.

### 1.4 Color tokens — iOS system grays

The existing `--color-gray-*` CSS custom properties in `style.css` get re-tuned to match iOS system grays. The names stay the same (no downstream code changes); only the hex values shift slightly to match Apple's gray ramp.

| Token | v1 value | v2 value (iOS system gray equivalent) |
|---|---|---|
| `--color-gray-100` | Tailwind neutral-100 | iOS `systemGray6` |
| `--color-gray-200` | Tailwind neutral-200 | iOS `systemGray5` |
| `--color-gray-300` | Tailwind neutral-300 | iOS `systemGray4` |
| `--color-gray-400` | Tailwind neutral-400 | iOS `systemGray3` |
| `--color-gray-500` | Tailwind neutral-500 | iOS `systemGray2` |
| `--color-gray-600` | Tailwind neutral-600 | iOS `systemGray` |
| `--color-gray-700` | Tailwind neutral-700 | iOS `secondaryLabel` equivalent |
| `--color-gray-900` | Tailwind neutral-900 | iOS `label` (near-black) |

The `accent-*` ramp (Tailwind indigo) is preserved — it's the brand color and shouldn't move.

The category palette (`--color-cat-*`) is untouched. The generic chart colorway (`--color-plot-*` — kept for naming compatibility) and the radial palette (`--color-radial-*`) are untouched.

### 1.5 Border radii — iOS-tuned

iOS uses a slightly different radius ramp than the current `rounded-lg` everywhere. v2 adopts these:

| Use | v1 | v2 |
|---|---|---|
| Cards | `rounded-lg` (8px) | `rounded-xl` (12px) |
| Buttons | `rounded-lg` (8px) | `rounded-lg` (10px adjusted in `style.css`) |
| Pills (chips, segmented toggles) | `rounded-full` | `rounded-full` (unchanged) |
| Sheets (bottom + flyout) | n/a | `rounded-t-2xl` (16px top corners on bottom sheets) |
| Dropdowns | `rounded-xl` | `rounded-xl` (unchanged) |
| Inputs | `rounded-lg` | `rounded-lg` (unchanged) |

### 1.6 Spacing

Existing Tailwind spacing scale unchanged. Common values:

- **Outer container body padding**: `px-4` on mobile (already in `base.html`), `px-6` on desktop
- **Card padding**: `p-6` (unchanged from v1)
- **Card-to-card gap**: `gap-4` (unchanged)
- **Section gap on Overview**: `gap-4` between the three stacked cards
- **Body content offset (desktop)**: `pl-16` to clear the 64pt side rail

### 1.7 Safe-area handling

iOS safe-area insets must be respected on:

- **Bottom tab bar**: pinned with `bottom: 0; padding-bottom: calc(env(safe-area-inset-bottom) + 8px);` — clears the home indicator with an extra 8px of breathing room
- **Top of large-title block**: `padding-top: calc(env(safe-area-inset-top) + 16px);` — clears the iOS status bar when in standalone PWA mode
- **Left edge (when notched in landscape)**: not relevant in v2 since the app is portrait-first; landscape unsupported (locked via manifest, see PWA shell doc)

The viewport meta tag in `base.html` must include `viewport-fit=cover` to enable safe-area-inset variables on iOS.

---

## 2. Navigation

Two navigation surfaces. Same content, different shape per viewport.

### 2.1 Mobile (<768px): bottom tab bar

```
┌──────────────────────────────────────┐
│                                      │
│            [page content]            │
│                                      │
│                                      │
├──────────────────────────────────────┤
│  ╒══════╕   ╒══════╕   ╒══════╕     │  ← tab bar
│  │  ▣   │   │  📊  │   │  ☰   │     │
│  │ Over │   │Habits│   │ Txns │     │
│  ╘══════╛   ╘══════╛   ╘══════╛     │
└──────────────────────────────────────┘
       ↑ safe-area-inset-bottom + 8pt
```

Specs:
- **Height**: 49pt + safe-area-inset-bottom + 8pt extra padding
- **Background**: opaque white, 1px top border `var(--color-gray-200)`. No blur.
- **Position**: `fixed; bottom: 0; left: 0; right: 0`. `z-index: 50`.
- **Tab cell**: equal-width thirds of the viewport. Each cell is the full tap target (~130pt wide on 390pt screens, well over 44pt).
- **Icon**: 24×24pt inline SVG. Outline by default, filled when active.
- **Label**: `text-xs font-medium`, sits below the icon with `mt-1`. `text-neutral-500` inactive, `text-accent-700` active.
- **Tab icons**: 
  - Overview: outline rectangle with horizontal lines (a "dashboard" feel)
  - Habits: outline bar-chart icon
  - Transactions: outline horizontal lines / list icon
  - All three drawn fresh as inline SVG; no icon library
- **Active state**: filled icon + `accent-700` label. Inactive: outline icon + `gray-500` label.
- **Transition between tabs**: instant (no animation). Page content slides in only via the large-title scroll, not via tab switching.

### 2.2 Desktop (≥768px): left side rail

```
┌─────┬────────────────────────────────────┐
│     │                                    │
│ ▣   │                                    │
│Over │                                    │
│     │       [page content]               │
│ 📊  │                                    │
│Habit│                                    │
│     │                                    │
│ ☰   │                                    │
│Txn  │                                    │
│     │                                    │
│     │                                    │
│     │                                    │
│ ⚙   │                                    │
│Set  │                                    │
└─────┴────────────────────────────────────┘
  ↑ 64pt wide
```

Specs:
- **Width**: 64pt
- **Position**: `fixed; left: 0; top: 0; bottom: 0`. `z-index: 50`.
- **Background**: opaque white, 1px right border `var(--color-gray-200)`. No blur.
- **Content offset on body**: `pl-16` (64pt) — main container starts at x=64.
- **Tab cell**: 64pt × 64pt for each. Stacked vertically with no gap from the top.
- **Icon + label per cell**: same 24×24pt icon + 11–12px label below, centered.
- **Active state**: 
  - Icon: filled, `accent-700`
  - Label: `accent-700`, `font-semibold`
  - Cell background: `bg-accent-50` block spanning the full cell width
- **Gear icon**: pinned to the bottom of the rail (`mt-auto`). Same cell shape. Opens Settings sheet on click.

### 2.3 Shared tab logic

- Tab state lives in JS as `activeTab: 'overview' | 'habits' | 'transactions'`
- Active tab persists across persona switches (since Settings sheet dismisses without changing tab)
- Browser history is preserved via `history.pushState` (`#overview`, `#habits`, `#transactions`) so back-button works correctly
- No tab transition animation; tab switches are instant

---

## 3. Page header

The most architecturally interesting section. The iOS large-title pattern is a real interaction model that touches every page.

### 3.1 The large-title pattern explained

iOS's signature navigation behavior. Three states:

1. **Initial**: at the top of scroll. Large 36pt title sits in the content area. No sticky bar visible.
2. **Mid-scroll**: as user scrolls down, the large title shrinks (interpolating between 36pt → 24pt) and its opacity fades. Simultaneously, a small 24pt sticky title fades in pinned to the top of the viewport. The sticky nav bar has a thin bottom border to separate it from the scrolling content.
3. **Fully-scrolled**: large title gone, sticky bar visible with 24pt title and any chrome elements (gear icon on mobile, tab-relevant controls).

When the user scrolls back to the top, the animation reverses smoothly.

### 3.2 Applied to v2

Every tab uses the large-title pattern. Every screen. The triggering scroll position is 60pt of scroll: at scroll-top, large title fully visible; at 60pt scrolled, sticky bar fully visible. Between 0 and 60pt, both interpolate linearly via opacity.

**Initial layout per tab:**

```
┌──────────────────────────────────────┐
│                                  ⚙   │  ← sticky bar zone, gear icon
│                                      │     (invisible until scroll)
│  Overview · NYC Student              │  ← eyebrow (large-title block)
│                                      │
│  Your Spending Snapshot              │  ← large title (36pt)
│  for May 2026 ⌄                      │     (with embedded month picker)
│                                      │
│  ─────────────────────────────────   │  ← thin divider before content
│                                      │
│  [page content begins]               │
└──────────────────────────────────────┘
```

**Scrolled-down layout (sticky bar visible):**

```
┌──────────────────────────────────────┐
│  Overview                       ⚙   │  ← sticky bar (24pt title)
│  ─────────────────────────────────   │     thin border below
│                                      │
│  [scrolled-down content]             │
│                                      │
└──────────────────────────────────────┘
```

### 3.3 Sticky bar specs

- **Height**: 44pt content height + safe-area-inset-top padding
- **Background**: opaque white (matches the tab bar — no blur)
- **Bottom border**: 1px `var(--color-gray-200)`, only visible when the sticky bar is active (opacity tied to scroll position)
- **Title**: `text-2xl font-semibold` (24pt), tab name only (e.g., `Overview`, `Habits`, `Transactions`)
- **Right side**: gear icon on mobile (24×24pt in a 44×44pt tap target, `text-neutral-700`). On desktop, the right side is empty (gear is in the side rail bottom).
- **Position**: `position: sticky; top: 0; z-index: 40` (under sheets at z-50 but above content)

### 3.4 Large-title block specs

- **Container**: `pt-[safe-area + 16pt] pb-4`
- **Eyebrow**: `text-sm font-medium text-neutral-500 mb-1`. Composed dynamically per tab (`Overview · NYC Student`, `Habits`, `Transactions`).
- **H1**: `text-4xl font-bold tracking-tight text-neutral-900`. 36pt SF.
- **Embedded interactive elements** (Overview month picker, Habits scope chip) live in this block. They are tappable when at the top of scroll. When scrolled, they're invisible and inert — to use them, the user scrolls back to the top.
- **Bottom divider**: 1px `var(--color-gray-100)`, sits below the large title. Provides separation from page content. This divider does NOT scroll out; it sits at the boundary between header and content.

### 3.5 Scroll listener implementation

A single global scroll listener on the main scroll container handles the interpolation for all tabs:

```
On scroll(y):
  progress = clamp(y / 60, 0, 1)
  largeTitle.opacity = 1 - progress
  largeTitle.transform = translateY(-progress * 20pt) scale(1 - progress * 0.15)
  stickyBar.opacity = progress
```

iOS rubber-band scrolling at the top sets y < 0; clamp to 0. Momentum overscroll past the bottom is naturally limited by content length.

Programmatic scrolls (e.g., when arriving via cross-tab linkout) jump-set the scroll position; the listener handles the resulting visual state correctly.

### 3.6 Embedded controls — discoverability

The month picker chevron on Overview (`May 2026 ⌄`) uses an explicit `⌄` SVG chevron in addition to the underline. The chevron makes the tappable affordance unmistakable on touch where hover states don't exist.

The Habits scope chip in the H1 uses the existing chip styling with the `▾` chevron and category emoji (e.g., `📊 All Spending ▾`).

Both are 44pt vertical tap targets via `py-2` padding.

### 3.7 Where headers don't follow this pattern

The **drill-down flyout** on Habits has its own header (see §4.4). It does NOT use the large-title pattern — flyouts have static, fixed headers with a back chevron + X button. Large-title is for the tab-level page; the flyout is a modal-ish surface within Habits.

---

## 4. Sheet and flyout system

Four surfaces share one of two primitives. Specifying once, reusing everywhere.

### 4.1 Bottom sheet primitive

Used by: Overview month picker, Settings sheet, Transactions filter sheet (mobile only).

**Anatomy:**

```
┌──────────────────────────────────────┐
│                                      │  ← dimmed backdrop (page below)
│                                      │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │            ▔▔▔▔▔                  │ │  ← grab handle
│ │  [Sheet header]              ✕   │ │
│ │  ────────────────────────────    │ │
│ │                                  │ │
│ │  [Sheet content]                 │ │
│ │                                  │ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

**Specs:**
- **Detent**: single fixed detent per sheet (see §4.3). No drag-to-expand-to-full.
- **Modal**: page below is dimmed (`rgba(0,0,0,0.4)`) and frozen (no scroll, no interaction).
- **Background**: opaque white
- **Border radius**: `rounded-t-2xl` (16px top corners only)
- **Grab handle**: centered, 36pt wide × 5pt tall, `bg-gray-300`, `rounded-full`. Sits 8pt from the top edge of the sheet.
- **Header**: optional, used by Settings. `text-base font-semibold` title, 24pt close icon top-right. 16pt padding all around. 1px bottom border `gray-100`.
- **Animation**:
  - Open: backdrop fades in (`opacity 0 → 1, 250ms`), sheet slides up from below (`translateY(100%) → translateY(0), 350ms`)
  - Close: reverse, same durations
  - Easing: `cubic-bezier(0.32, 0.72, 0, 1)` (iOS-native)
- **Dismissal**:
  - Tap backdrop
  - Swipe down: if release point > 100pt below start AND velocity > 0.5pt/ms, dismiss. Otherwise snap back.
  - X button (Settings only — month picker and filter sheet use a tap-row-and-dismiss pattern instead)
- **Focus management**: focus moves into the sheet on open (first interactive element); returns to the trigger on close.

### 4.2 Bottom sheet detents per use

| Sheet | Detent height | Why |
|---|---|---|
| Overview month picker | 50% of viewport (`max-h-[50vh]`) | List of ~46 months, scrollable inside the sheet |
| Settings | `max-h-[40vh]` (fits content) | One section + About footer, doesn't need more |
| Transactions filter | `max-h-[50vh]` | Category dropdown + month picker + clear button |

### 4.3 Right flyout primitive

Used only by: Habits drill-down.

**Mobile anatomy (full-screen):**

```
┌──────────────────────────────────────┐
│  ← April 2026 Spending           ✕   │  ← flyout header (sticky)
│  ─────────────────────────────────   │
│                                      │
│  [B1: pie + quick stats]             │
│                                      │
│  [B2: cumulative + top locations]    │
│                                      │
│  [B3: daily-totals strip]            │  ← replaces bubble on mobile
│                                      │
│  [B4: stacked txn rows]              │
│                                      │
└──────────────────────────────────────┘
              [tab bar]
```

**Desktop anatomy (push, Trends compresses):**

```
┌──────────────┬───────────────────────┐
│              │ ← April 2026  ✕      │
│  [Trends     │ ─────────────────────│
│   compressed │                       │
│   to ~50%]   │  [B1: pie | stats]   │
│              │                       │
│  [chart      │  [B2: cum | locations]│
│   still      │                       │
│   interactive│  [B3: bubble chart]   │  ← bubble preserved on desktop
│   here]      │                       │
│              │  [B4: txn table]      │
└──────────────┴───────────────────────┘
```

**Specs:**
- **Mobile**: full viewport width, full viewport height. Tab bar remains visible below it.
- **Desktop**: 50% viewport width (`md:w-1/2`), Trends panel compresses to the other 50%. 1px left border on the flyout (`gray-200`) separates the two panes.
- **Animation**:
  - Open: slides in from right (`translateX(100%) → translateX(0)`). On desktop, Trends pane animates its width from 100% → 50% simultaneously.
  - Close: reverse.
  - Duration: 350ms. Easing: `cubic-bezier(0.32, 0.72, 0, 1)` (matches sheet).
- **Header**: 56pt tall, sticky to top of flyout. Contains:
  - Left: back chevron (`←`) — alternative dismiss control, especially helpful on desktop
  - Center: `text-base font-semibold` flyout title (e.g., `April 2026 Spending`)
  - Right: X button (24×24pt in 44×44pt tap target)
- **Dismissal** (mobile):
  - X button
  - Back chevron
  - Swipe right: if release > 80pt right of start AND velocity > 0.5pt/ms, dismiss. Otherwise snap back.
- **Dismissal** (desktop):
  - X button
  - Back chevron
  - Click anywhere in the compressed Trends pane (which counts as "outside")
  - Escape key

### 4.4 Shared sheet/flyout behaviors

- **Scroll locking**: when any sheet or flyout is open, the underlying page scroll is locked (set `body.style.overflow = 'hidden'`). Restored on close.
- **Focus trap**: keyboard focus is trapped within the open sheet/flyout; Tab cycles within it.
- **z-index stack**: backdrop at 49, sheet/flyout at 50, sticky nav bar at 40, tab bar at 50 (tab bar can be above flyouts on mobile or hidden — see below).
- **Tab bar visibility during flyout**: on mobile, the bottom tab bar **stays visible** while the Habits drill-down flyout is open. The user can switch tabs from the flyout, which dismisses it implicitly.

---

## 5. Overview tab — applied design

### 5.1 Layout

```
[Large-title block]
  Overview · NYC Student
  Your Spending Snapshot for May 2026 ⌄

[Card 1: Combined snapshot]
[Card 2: Cumulative chart, with header switch]
[Card 3: Top categories]

[Tab bar / Side rail]
```

All three cards full-width, stacked, `gap-4` between them. Single column on every screen — even desktop. The cards have generous internal padding (`p-6`); on desktop, the cards are centered in the existing `max-w-6xl` container.

### 5.2 Card 1: Combined snapshot

```
┌──────────────────────────────────────┐
│ Spent so far in May                  │  ← label
│                                      │
│ $1,750                               │  ← 60pt value
│                                      │
│ ↓ 12% less than April                │  ← smart message
│                                      │
│ ────────────────────────             │
│ See transactions →                    │  ← link button
└──────────────────────────────────────┘
```

- Label: `text-base font-semibold text-neutral-900`
- Value: `text-6xl font-semibold tracking-tight text-neutral-900 tabular-nums` — 60pt, kept from v1
- Smart message: `text-sm font-medium` + direction color (`text-utility-red-700` for "up" / more spending; `text-utility-green-700` for "down" / less; `text-neutral-600` for "flat")
- Link button: existing `linkButton()` helper unchanged

### 5.3 Card 2: Cumulative chart

```
┌──────────────────────────────────────┐
│ Cumulative spend in May    [⇄ April] │  ← header + switch (right-aligned)
│                                      │
│      ╱─────────                      │
│     ╱     ╱╱╱╱                       │
│    ╱  ╱╱╱╱                           │
│   ╱╱╱╱                               │  ← chart
│ ─────                                │
│                                      │
└──────────────────────────────────────┘
```

- Card padding: `p-4 sm:p-6`
- Header: `text-base font-semibold` left, switch on the right
- **Switch**: small iOS-style switch (`w-10 h-6 rounded-full`), `bg-gray-300` off / `bg-accent-700` on, with label `Overlay April` immediately to its left in `text-xs text-neutral-600`. Tap toggles overlay state.
- Chart container: `style="height: 240px"` on mobile, `height: 320px` on desktop
- Chart.js config: see §8

### 5.4 Card 3: Top categories

```
┌──────────────────────────────────────┐
│ Top Categories in May          (i)   │  ← label + info tooltip
│                                      │
│ 🍔 Restaurants        $312           │
│ 🛒 Groceries          $245           │  ← chip-list
│ ☕ Cafés              $98            │
│                                      │
│ ────────────────────────             │
│ Open in Habits →                     │
└──────────────────────────────────────┘
```

- Chip styling: existing `catChipStyle()` + `catLabelHtml()` — `text-sm`, `px-2.5 py-1`, `rounded-full`
- Each row: chip on the left, amount on the right (`text-sm font-medium tabular-nums`), full row spans the card width with `justify-between`
- Vertical rhythm: `space-y-2` between rows

### 5.5 Month picker behavior

- **Mobile**: tapping the underlined month + chevron opens a bottom sheet (per §4.1) with the list of months newest-first. Active month highlighted with `bg-gray-100 font-semibold`. Tapping a month re-renders Overview and dismisses the sheet.
- **Desktop**: existing dropdown panel anchored under the title — unchanged from v1.

---

## 6. Habits tab — applied design

### 6.1 Trends home view

```
[Large-title block]
  Habits
  Your Habits for 📊 All Spending ▾

[Chart controls row]
  [Timeframe ▾]    [Total ↔ Stacked]    [Bar ↔ Radial]  ← last toggle desktop-only

[Chart card]
  [Monthly bar chart, 360pt tall mobile / 480pt desktop]

[Tab bar / Side rail]
```

No KPI strip. No always-rendered drill-down. The tab is dominated by the chart.

### 6.2 Chart controls row

A single horizontal row between the H1 block and the chart card. On mobile, controls wrap if needed (with `flex-wrap gap-2`).

- **Timeframe picker**: pill-shaped button (`text-sm font-medium px-3 py-2 rounded-lg border border-gray-200 bg-white`), label is the active range (`Last 12 months ⌄`). Tapping opens a small dropdown panel anchored under the button on every screen — this one stays a panel, not a sheet, because the option list is short (5 items).
- **Total ↔ Stacked toggle**: segmented control (existing `habits-view-toggle` styling — unchanged from v1, but with adjusted border radius to match v2's `rounded-lg`).
- **Bar ↔ Radial toggle**: desktop-only (`hidden md:inline-flex` preserved from v1). Inert on mobile.

### 6.3 Chart card

- Container: `bg-white border border-gray-200 rounded-xl p-4 sm:p-6`
- Chart height: 360pt mobile, 480pt desktop (`style="height: 360px"` with `md:style="height: 480px"` — needs inline style override or a `min-h` class since Chart.js needs definite heights)
- Tap a bar: opens drill-down flyout
- Chart.js config: see §8

### 6.4 Drill-down flyout — contents per device

**Mobile layout** (full-screen, stacked vertically):

```
[Flyout header: ← April 2026 Spending ✕]

[B1 section]
  ┌────────────────────────────────┐
  │ [Proportion ↔ Composition]     │  ← segmented control band
  ├────────────────────────────────┤
  │                                │
  │      [Pie chart]               │
  │                                │
  ├────────────────────────────────┤
  │ Avg Transaction                │
  │ $42.31                         │
  │ ↑ +14% vs March                │
  ├────────────────────────────────┤
  │ Total Transactions             │  ← quick stats stacked
  │ 47                             │
  │ ↓ -8% vs March                 │
  ├────────────────────────────────┤
  │ Most Active Day                │
  │ Saturday                       │
  └────────────────────────────────┘

[B2 section]
  ┌────────────────────────────────┐
  │ Cumulative Spend — April 2026  │
  │ [chart]                        │
  └────────────────────────────────┘
  ┌────────────────────────────────┐
  │ Top Categories                 │
  │ 🍔 Restaurants    $98          │
  │ 🛒 Groceries      $84          │  ← chip-list
  └────────────────────────────────┘

[B3 section]
  ┌────────────────────────────────┐
  │ Daily Spend — April 2026       │  ← daily-totals strip replaces bubble
  │ [bar strip, one bar per day]   │
  └────────────────────────────────┘

[B4 section]
  ┌────────────────────────────────┐
  │ All Transactions — April 2026  │
  │ [stacked txn rows]             │  ← same pattern as Transactions tab
  └────────────────────────────────┘
```

**Desktop layout** (within the 50% flyout pane):

- B1: existing 2-column (pie 40% / quick stats 60% in a 3-card stack)
- B2: existing 2-column (cumulative 60% / locations 40%)
- B3: full-width bubble scatter (preserved on desktop)
- B4: full-width table

### 6.5 Pie chart Proportion ↔ Composition toggle

- Placement: a segmented control band **above** the pie chart, full width of the pie card
- Active state shows which mode is current. Disabled (greyed out) at scopes where the toggle doesn't apply (leaf scope, all scope)
- Uses the existing `dd-pie-mode-btn` data attribute pattern for event delegation

### 6.6 Daily-totals strip (mobile B3)

Replaces the bubble chart on mobile. Visual: a row of vertical bars, one per day of the month, height = total spend that day.

- Height: 80pt
- Each bar: 4pt wide with 2pt gap (so ~30 days of bars fit comfortably on a 390pt viewport with side padding)
- Bar color: scope's accent color (matches the parent or leaf color via `catHex()`)
- Y-axis: invisible, auto-scaled
- X-axis: tick labels every 7 days (`1, 8, 15, 22, 29`)
- Interaction: none — purely visual at-a-glance
- Title above: `Daily Spend — April 2026`, `text-sm font-semibold`

### 6.7 Scope chip

Inside the H1 large title block. Existing styling (chip with parent/leaf color + emoji + label + chevron) — unchanged from v1 visually. The chip-bar underline below it (the colored pill underline tied to the active scope's `--cat-fg`) is preserved.

Tapping opens `#hc-chip-panel` — on every screen, this stays as the existing dropdown panel anchored under the chip. (Not a bottom sheet — the category hierarchy is too deep for a small detent and works fine as a tall panel.)

---

## 7. Transactions tab — applied design

### 7.1 Mobile layout

```
[Large-title block]
  Transactions
  All transactions

[Search + Filter row]
  ┌──────────────────────┐  ┌────────┐
  │ 🔍 Search merchant…  │  │ Filter │  ← filter button with optional count
  └──────────────────────┘  └────────┘

[Month group]
  ── May 2026 (32 transactions) ──
  ┌────────────────────────────────┐
  │ Starbucks            −$7.45    │
  │ ☕ Cafés             May 24    │  ← stacked row
  └────────────────────────────────┘
  ┌────────────────────────────────┐
  │ Whole Foods         −$84.20    │
  │ 🛒 Groceries         May 24    │
  └────────────────────────────────┘
  ...

[Month group]
  ── April 2026 (47 transactions) ──
  ...

[Load older button]
  ┌──────────────────────────────────┐
  │     Load February 2026 →         │
  └──────────────────────────────────┘

[Tab bar]
```

### 7.2 Search + Filter row

- Container: `flex gap-2`
- Search input: `flex-1`, `text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white`. Placeholder: `Search merchant…`. Debounced 100ms.
- Filter button: `text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 bg-white`. Label is `Filter` plus optional count badge: `Filter · 2` when filters active. The badge styling: `bg-accent-100 text-accent-700 text-xs font-semibold rounded-full px-1.5 py-0.5 ml-1`.

### 7.3 Filter sheet (mobile)

Triggered by the Filter button. Opens as a bottom sheet (§4.1).

```
┌──────────────────────────────────────┐
│            ▔▔▔▔▔                      │
│  Filter Transactions             ✕   │
│  ────────────────────────────────    │
│                                      │
│  CATEGORY                            │
│  [Select category ▾]                 │
│                                      │
│  MONTH                               │
│  [📅 May 2026]                       │
│                                      │
│  ────────────────────────────────    │
│  [   Clear all filters   ]           │
│                                      │
└──────────────────────────────────────┘
```

- Sheet title: `Filter Transactions`
- Category section: existing `<select>` styled to match v2's bg-white inputs
- Month section: existing `<input type="month">` which gets the iOS native picker on iOS
- Clear-all button: full-width pill at bottom, `text-sm text-neutral-600 underline`. Clears all filters and dismisses the sheet.
- Tapping outside or swiping down also dismisses, applying any in-sheet changes.

### 7.4 Desktop layout

Inline filter row instead of a Filter button + sheet:

```
[Large-title block]
[🔍 Search]  [Category ▾]  [📅 Month]

[Month group]
  ── May 2026 (32 transactions) ──
  | Date  | Merchant     | Category   | Account | Amount  |
  | May 24| Starbucks    | ☕ Cafés   | Chase   | −$7.45  |
  | May 24| Whole Foods  | 🛒 Groc.   | Amex    | −$84.20 |
  ...

[Month group]
  ── April 2026 (47 transactions) ──
  ...

[Load older button — centered]
```

- Inline filter row: existing v1 layout, `flex flex-wrap gap-3 mb-5`
- Table inside each month group: existing v1 table — header row + transaction rows
- One table per month, OR one table per page with grouped headers as rows? Implementation pattern: one table per month, with the month header as a `<caption>` or as a regular div above each table. Engineering doc picks.

### 7.5 Stacked row (mobile)

- Container: `bg-white border-b border-gray-100 px-4 py-3`. Full row tap target.
- First line: merchant name on left (`text-base font-medium text-neutral-900 truncate`), amount on right (`text-base font-semibold tabular-nums text-neutral-900`). Use `flex justify-between`.
- Second line: category chip on left (existing chip styling, `text-xs`), date on right (`text-xs text-neutral-500`). `mt-1`.
- Row height: ~72pt minimum (well above 44pt minimum tap target)

### 7.6 Month group header

```
── May 2026 (32 transactions) ──
```

- `text-base font-semibold text-neutral-600 uppercase tracking-wide`
- Padding: `px-4 pt-6 pb-2` (more top padding to separate from the prior month group)
- Underlines: not literal dashes — a 1px `bg-gray-200` strip on left and right of the text, achieved with `flex items-center` and pseudo-element strips. Or just text alone with a thin border below. Either is fine; the visual goal is "section header, scannable."

### 7.7 Load older button

- Container: centered, `pt-6 pb-12` (extra bottom padding for tab bar clearance)
- Button: `px-6 py-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-neutral-700`
- Label: `Load February 2026 →` — month name is the next-older calendar month, or the next-older month with matches when a filter is active
- Disappears when there's no older data

### 7.8 Filtered view subtitle

The dynamic subtitle pattern from v1 is preserved. Examples:

- No filter: `All transactions`
- Search active: `Matching "starbucks"`
- Category + month: `Cafés · May 2026`
- All three: `Cafés · May 2026 · matching "starbucks"`

On mobile, the subtitle sits below the H1 in the eyebrow position. On desktop, same.

---

## 8. Chart treatment on phone

Chart.js is the rendering library for v2. The hand-rolled radial chart (desktop only) is a separate SVG component. v2 tunes every chart for touch and narrower viewports.

### 8.1 Global Chart.js defaults

Set once at app boot via `Chart.defaults`:

```js
Chart.defaults.font.family = '-apple-system, system-ui, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.color = token('color-gray-700');
Chart.defaults.borderColor = token('color-gray-100');
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.plugins.legend.display = false;       // legends rarely earn their slot
Chart.defaults.plugins.tooltip.enabled = true;       // Chart.js tooltips are touch-friendly out of the box
Chart.defaults.animation.duration = 200;             // snappier than the default 1000ms
```

Per-viewport adjustments are handled inside each chart's options builder, not in defaults.

### 8.2 Tighter padding on mobile

The padding/layout shape Chart.js exposes is different from Plotly's margins. A small helper builds per-chart layout:

```js
function chartLayout() {
  const isMobile = window.innerWidth < 768;
  return {
    layout: {
      padding: isMobile
        ? { left: 4, right: 8, top: 8, bottom: 4 }
        : { left: 8, right: 16, top: 12, bottom: 8 },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: token('color-gray-500'), font: { size: isMobile ? 11 : 12 } } },
      y: { grid: { color: token('color-gray-100') }, ticks: { color: token('color-gray-500'), font: { size: isMobile ? 11 : 12 } } },
    },
  };
}
```

Spread into each chart's options object: `{ ...chartLayout(), ...chartSpecific }`. Called fresh at render time so it picks up the current viewport.

### 8.3 Tooltip behavior

Chart.js handles touch out of the box: tapping a chart element shows a tooltip at that point. No custom tap-and-hold layer needed.

Tooltip styling matches the existing `tipCard()` aesthetic by configuring `external` tooltip callbacks — a single function returns HTML that mirrors the existing tooltip styling (rounded-lg, white bg, neutral border, shadow). This stays the same across all chart types.

For the bar chart in Habits Trends, the tap interaction is intercepted to open the drill-down flyout instead of showing a tooltip. `options.onClick = (event, elements) => { if (elements.length) openDrillDownFlyout(...) }`. No tooltip on bar tap; the flyout *is* the response.

### 8.4 Per-chart specs

**Overview cumulative chart**: Chart.js `line` chart. 240pt mobile / 320pt desktop. Single line by default; optional second dashed line for last month when the card-header switch is on. X-axis: day-of-month labels every 5 days. Y-axis: dollar-formatted ticks. Tooltip on point tap.

**Habits trend chart (bar)**: Chart.js `bar` chart. 360pt mobile / 480pt desktop. Stacked vs. unstacked toggled via `stacked: true/false` on the scales. Tap a bar triggers `onClick` → opens drill-down flyout. Brief Chart.js animation (200ms) on render satisfies the "feedback on tap" need.

**Habits trend chart (radial)**: hand-rolled SVG component in `static/js/radial.js`. Desktop only (`md:` and up). One ring per selected year. Year multi-select picker unchanged. Click-to-month-focus emits the same setter calls as the bar version. See engineering doc for full SVG structure.

**Drill-down pie chart**: Chart.js `doughnut` chart. 240pt mobile / 280pt desktop. Two modes — Proportion (one slice for the scoped category, one for everything else) and Composition (children of the scoped parent). Mode toggle is the segmented control band above the pie. Tooltip on slice tap.

**Drill-down cumulative chart**: Chart.js `line` chart. 200pt mobile / 220pt desktop. Tooltip on point tap.

**Drill-down daily-totals strip (mobile B3 only)**: Chart.js `bar` chart with single dataset, one bar per day-of-month. 80pt tall. No tooltip, no interaction. Pure glance viz. Bar color = scope's accent color via `catHex()`.

**Drill-down bubble chart (desktop only)**: Chart.js `bubble` chart. The hand-rolled stacking algorithm from v1 is preserved — it computes Y-positions for each transaction so bubbles on the same day stack without overlap. The computed `{x, y, r}` array feeds the `bubble` dataset directly. Bi-directional hover-link with the table below uses Chart.js's `getElementsAtEventForMode` for the chart→table direction and an `update()` call on the chart for the table→chart direction.

### 8.5 Color helpers preserved

`token()`, `catHex()`, `radialColors()`, etc., are preserved verbatim. Color tokens still resolve at render time via `getComputedStyle`. The `plotlyLayout()` helper is replaced by `chartLayout()` (§8.2); `radialColors()` continues to feed the hand-rolled SVG radial chart.

The only token change is the iOS-tuned values for the `--color-gray-*` tokens (§1.4) — all chart code reads from these tokens, so updating the token values propagates to every chart automatically.

---

## 9. Design system extensions

What `DESIGN-SYSTEM.md` and `style.css` need to gain to support v2. This section is the inventory; engineering doc has the implementation details.

### 9.1 Removed from v1

- `<link>` to Inter font in `base.html`
- Plotly CDN script tag in `base.html` (replaced by Chart.js)
- v1 secondary navigation styles (`.secondary-nav`, etc.)
- Top-right dataset switcher dropdown markup and styles
- Card 3 (3-month average) rendering function and its `infoTooltip` strings
- Card 4 (top categories) grid position styles
- KPI strip markup on Habits
- Drill-down month chip (`#dd-month-btn`) and `buildDrillDownMonthPanel()`
- `txn-prev` / `txn-next` button styles and `txn-count` line
- `plotlyLayout()`, `setChartA11y()`, and any other Plotly-specific helpers in `app.js`

### 9.2 New tokens in `style.css`

- Adjusted `--color-gray-100` through `--color-gray-700` to match iOS system grays (per §1.4)
- New: `--ios-sheet-bg: var(--color-white)`
- New: `--ios-sheet-handle: var(--color-gray-300)`
- New: `--ios-backdrop: rgba(0, 0, 0, 0.4)`

### 9.3 New component classes

- `.ios-sheet`: bottom sheet container shell
- `.ios-sheet-backdrop`: full-screen dimmer
- `.ios-sheet-handle`: the grab handle pill
- `.ios-flyout-right`: right flyout shell
- `.ios-flyout-backdrop`: backdrop for desktop right flyout
- `.large-title`: H1 large-title styles
- `.large-title-sticky`: sticky bar styles
- `.tab-bar` / `.tab-bar-item`: bottom tab bar
- `.side-rail` / `.side-rail-item`: left side rail
- `.txn-row-stacked`: mobile stacked transaction row
- `.month-group-header`: section header for grouped transactions
- `.daily-totals-strip`: B3 mobile replacement chart container

### 9.4 New JS helpers

To be exposed in `app.js` (or a new `ios.js` module — engineering doc decides):

- `openBottomSheet(config)` / `closeBottomSheet()`
- `openRightFlyout(config)` / `closeRightFlyout()`
- `initLargeTitleScroll(containerEl, options)`
- `wireSwipeDismiss(el, direction, threshold, onDismiss)`
- `lockBodyScroll()` / `unlockBodyScroll()`
- `chartLayout()` — Chart.js layout/scales builder, replaces `plotlyLayout()`

Plus the new `radial.js` module containing the hand-rolled SVG radial chart (~150 LOC). Exposes `renderRadial(container, data, selectedYears, options)` and emits a `month-click` custom event the Habits tab listens for.

### 9.5 Markup changes to `base.html`

- Remove the existing secondary nav region
- Add the mobile tab bar markup (visible at <768px)
- Add the desktop side rail markup (visible at ≥768px)
- Add the gear icon (top-right of large-title sticky bar on mobile, bottom of side rail on desktop)
- Add the persistent sheet/flyout containers (off-screen by default, populated dynamically)
- Update viewport meta tag with `viewport-fit=cover`

---

## 10. What this doc deliberately leaves to engineering

This is a design spec. The following are engineering decisions:

- Where the large-title scroll listener attaches (window vs. a scroll container)
- Whether the Transactions per-month sections are individual `<table>` elements or a single virtualized list with sticky `<thead>` rows
- How the dataset switcher actually swaps JSON folders client-side
- Service worker integration with the new asset paths
- The Chart.js bundle strategy — CDN, npm install + local copy, or tree-shaken build with only the chart types used
- The hand-rolled radial chart implementation details (SVG structure, data → path string conversion, click hit-testing, year-ring layout math)

These all get resolved in `PRD-v2-engineering.md`.
