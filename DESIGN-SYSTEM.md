# MoneyHabits Design System

Rules that constrain how we build pages in this app. Established during the Overview tab work; intended to apply to Habits, Transactions, and any future surfaces.

These are **rules**, not aspirations. If a rule doesn't fit a new use case, propose changing the rule before building around it.

---

## 1. Foundations

### 1.1 Color

| Use | Class / token |
|---|---|
| Page background | `bg-gray-50` (set on `<body>`, don't override) |
| Card / surface background | `bg-white` |
| Card border | `border border-gray-200` |
| Primary text | `text-gray-900` |
| Body / muted text | `text-gray-600` |
| Disabled / placeholder | `text-gray-400` |
| Interactive accent | `accent-500` (default), `accent-600` (hover) — indigo ramp from `tailwind.config.js` |
| Chart accent line | `--color-accent-500` via `token()` helper |
| Chart muted line / grid | `--color-gray-400`, `--color-gray-100` via `token()` |

Source of truth: `tailwind.config.js` for the `accent` ramp; Tailwind defaults for `gray`. JS-consumed colors mirror these in `static/css/style.css :root` as CSS custom properties.

**Don't**: introduce ad-hoc hex codes anywhere — JS, HTML, or CSS. If you need a new color in JS, add it as a CSS custom property in `style.css :root` first.

### 1.2 Typography scale

The scale is intentionally narrow. Don't introduce new sizes ad-hoc.

| Use | Class | Px |
|---|---|---|
| Page title (`<h1>`) | `text-3xl font-semibold tracking-tight text-gray-900` | 30 |
| Page subtitle / context | `text-sm text-gray-600` | 14 |
| Card value (primary number) | `text-6xl font-semibold tracking-tight text-gray-900` | 60 |
| Card value placeholder (`—`) | `text-6xl font-semibold tracking-tight text-gray-400 cursor-help` | 60 |
| Card label | `text-base font-semibold text-gray-900` | 16 |
| Card body list row | `text-base font-medium text-gray-900` | 16 |
| Card context line (e.g. smart message) | `text-sm text-gray-600` | 14 |
| Ghost button label | `text-sm font-medium text-gray-700` | 14 |
| Tooltip / fine-print fallback | `text-xs text-gray-600` | 12 |
| Empty-state body | `text-sm text-gray-400` | 14 |

Always pair `font-semibold` with `tracking-tight` for large numerals — Inter at large sizes looks loose without it.

### 1.3 Spacing

Use Tailwind's default scale. No custom spacing tokens.

- Outer container: `max-w-6xl mx-auto px-4 sm:px-6 py-8` (already in `base.html` — don't bypass)
- Card padding: `p-6`
- Grid gap between cards: `gap-4`
- Internal stack spacing inside a card: `mt-3` (label → value), `mt-2` (value → context)
- Bottom-pinned content: wrap in `<div class="mt-auto pt-6">…</div>` so the wrapper consumes leftover height

### 1.4 Category palette

Categories use a two-channel meaning system: **hue carries parent group; emoji carries leaf identity** (§1.5). All category color values live as CSS custom properties in `static/css/style.css :root`.

**Slug system** (defined in `app.js`):
- 4 parent slugs: `food`, `personal`, `car`, `shopping` (orange / pink / blue / emerald)
- 19 orphan slugs (no parent in CSV): one Tailwind family each
- 1 fallback: `default` (gray)

Each slug exposes three shades:

| Suffix | Tailwind shade | Used for |
|---|---|---|
| `-bg` | 100 | chip background |
| `-fg` | 700 | chip text color |
| `-mid` | 500 | Plotly traces, large dots |

**Inheritance:** children of a parent group resolve to the parent's slug via `/api/category-meta`. Restaurants, Cafés, Groceries, Bars, and Fast Food all render with `--color-cat-food-*`. The lookup happens in `catSlug(catNorm)` and is memoized at module load.

**Helpers** (use these — never compose color classes by hand):

```js
catSlug(cat)        // → 'food' | 'personal' | … | 'default'
catChipStyle(cat)   // → 'background-color:var(--color-cat-{slug}-bg);color:var(--color-cat-{slug}-fg);'
catHex(cat, shade)  // → resolved hex via token() — for Plotly
```

**Rule:** never write `bg-orange-100` or `text-pink-700` directly for a category. Use `catChipStyle()` so the source of truth stays in one CSS block. To tweak any category's color, edit `style.css`; no JS change required.

### 1.5 Category emoji

Each of the 32 named leaf categories has a unique emoji. The mapping lives in `CATEGORY_EMOJI` in `app.js` (one source of truth).

**Helpers:**

```js
catEmoji(cat)       // → '🍔' or '' if Uncategorized / unknown
catLabelHtml(cat)   // → '<span class="cat-emoji">🍔</span>Restaurants' (HTML-safe)
```

**Rendering:** emoji are native Unicode, never Twemoji or third-party images. Wrap with `<span class="cat-emoji">…</span>` so the CSS font stack locks rendering to the OS color-emoji font (`Apple Color Emoji`, `Segoe UI Emoji`, `Noto Color Emoji`, `Twemoji Mozilla`, `emoji`). Without the wrapper, emoji can fall through to a non-emoji glyph in some font contexts.

**Variation selectors:** code points that default to text presentation (`✈`, `🍽`, `🛍`, `🏋`, `🎟`) require the `️` (U+FE0F) suffix — already baked into the table.

**Where emoji render:**
1. Category chip (§2.6) — anywhere a leaf name is shown as a label
2. Category icon circle (§2.7) — drilldown header

When adding a render surface that shows a category name, use `catLabelHtml(cat)` — never bare `escHtml(cat)`.

---

## 2. Components

### 2.1 Card

The primary content container. Always `flex flex-col h-full` so a grid can stretch peer cards to matching heights and bottom content stays aligned across the row.

```html
<div class="bg-white border border-gray-200 rounded-lg p-6 h-full flex flex-col">
  <p class="text-base font-semibold text-gray-900">Card label</p>
  <p class="text-6xl font-semibold tracking-tight text-gray-900 mt-3 break-words">$1,750</p>
  <!-- optional context: smart message, list, footer -->
  <div class="mt-auto pt-6">
    <!-- ghost button -->
  </div>
</div>
```

Constants live in `app.js`:

```js
const CARD_SHELL = 'bg-white border border-gray-200 rounded-lg p-6 h-full flex flex-col';
const CARD_LABEL = 'text-base font-semibold text-gray-900';
const CARD_VALUE = 'text-6xl font-semibold tracking-tight text-gray-900 mt-3 break-words';
const CARD_VALUE_MISS = 'text-6xl font-semibold tracking-tight text-gray-400 mt-3 cursor-help';
```

Reuse these constants for any new card on any tab.

### 2.2 Ghost button

The **only** click-through type used inside content surfaces. Use it whether the destination is another tab, a side panel, or a modal.

```html
<button type="button" data-overview-action="action-key"
  class="inline-flex items-center justify-center gap-1.5 w-full
         text-sm font-medium text-gray-700
         border border-gray-300 rounded-lg
         px-3.5 py-2
         bg-white shadow-sm
         hover:bg-gray-50 hover:border-gray-400
         focus:outline-none focus:ring-2 focus:ring-accent-500
         transition-colors">
  Action label
  <span aria-hidden="true">&rarr;</span>
</button>
```

The `ghostButton(label, action)` helper in `app.js` produces this exact markup. Use the helper, not a copy-paste.

Rules:
- Trailing `→` is part of the label (signals navigation). No leading icon.
- `w-full` so it stretches to the card's content width — gives a row of cards a uniform horizontal rhythm.
- Click handlers are wired via event delegation on a `[data-overview-action]` attribute, not inline `onclick`.

### 2.3 Info icon

For inline help on a card label or a value. Long-form explanatory copy goes in a styled popover anchored to the icon — never the native browser tooltip (`title` attr) and never a footer paragraph.

Use the `infoTooltip(text)` helper in `app.js`:

```js
${infoTooltip("Calculated from the last 3 complete months of spending.")}
```

It expands to:

```html
<span class="info-tt shrink-0 text-gray-400" tabindex="0">
  <!-- 14×14 OVERVIEW_INFO_ICON SVG -->
  <span class="info-tt-bubble">Helper text here</span>
</span>
```

Rules:
- Always use the helper, not hand-rolled markup. Single source of truth for icon size, bubble styling, and arrow.
- **Don't** use the `title` attribute or `cursor-help` class — both produce ugly native browser UI; the helper styles its own bubble (gray-900 bg, white text, triangle pointer) and leaves the cursor as default.
- The popover opens on hover **and** focus (`:focus-within`) so it's keyboard-accessible. The trigger has `tabindex="0"`.
- Bubble width is fixed at `14rem` (~14 words wraps gracefully) with `max-width: 90vw` so it never clips on narrow screens.

### 2.4 Em-dash placeholder

Used when a value can't be computed (insufficient history, no data). Always render the card surface — never blank-out a grid cell.

```html
<p class="text-6xl font-semibold tracking-tight text-gray-400 cursor-help"
   title="Why this value isn't available">—</p>
```

In the placeholder state, hide the ghost button (the destination has no meaningful data behind it). Keep the card label visible.

### 2.5 Tab nav

Three tabs, defined in `templates/base.html`. Switching is handled by `showTab(name)` in `app.js` and lazy-inits each tab on first activation.

```html
<nav class="flex gap-1" id="tab-nav">
  <button data-tab="overview"     class="tab-btn …">Overview</button>
  <button data-tab="habits"       class="tab-btn …">Habits</button>
  <button data-tab="transactions" class="tab-btn …">Transactions</button>
</nav>
```

Active-tab visual: `bg-accent-100 text-accent-700`. Inactive: `text-gray-600 hover:bg-gray-100`.

### 2.6 Category chip

The default visual treatment for any category label. Used on Transactions rows, Habits category cards, the excludes panel, and the picker modal.

```html
<span class="inline-block text-xs px-2 py-0.5 rounded-full"
      style="${catChipStyle(cat)}">${catLabelHtml(cat)}</span>
```

Rules:
- Background and text color always come from `catChipStyle(cat)` (inline style) — never hardcoded Tailwind color classes (§1.4).
- Label always renders via `catLabelHtml(cat)` so the emoji is included (§1.5).
- Sizing and shape (`text-xs px-2 py-0.5 rounded-full`) are fixed — don't introduce a "large chip" variant. For larger sizes, use the icon circle (§2.7) instead.
- When the chip is the only color cue on a row, drop any prior colored dot. The chip background already encodes the parent hue.

### 2.7 Category icon circle

For headings or hero contexts where a chip-pill is too small. The emoji sits inside a soft-bg circle with the label rendered as plain text alongside it.

```html
<div class="flex items-center gap-3">
  <span id="dd-color-dot"
        class="w-10 h-10 rounded-full flex-none inline-flex items-center justify-center text-xl"
        style="${catChipStyle(cat)}">
    <span class="cat-emoji" style="margin-right:0">${catEmoji(cat)}</span>
  </span>
  <h3 class="font-bold text-2xl text-gray-500">Category Name</h3>
</div>
```

Rules:
- The circle takes its background from `catChipStyle()` like the chip — same source of truth.
- Inner emoji span needs `style="margin-right:0"` to override `.cat-emoji`'s default right-margin so it stays centered.
- Label is plain text outside the circle, NOT wrapped in `catLabelHtml()` (avoids double-emoji).
- Use only at heading/hero scale (`text-2xl` and up). For body-level category labels, use the chip (§2.6).

---

## 3. Layout patterns

### 3.1 Equal-weight card grids

Whenever showing multiple stats or categorical surfaces, use a single grid with equal-weight cards. Don't nest cards inside cards. Don't visually "demote" some to reference strips.

```html
<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
  <!-- four equal cards -->
</div>
```

Picking N: pick the largest N that keeps the biggest expected card value on one line at the breakpoint. With `text-6xl` numbers and 4 cards inside `max-w-6xl`, `md:grid-cols-4` works down to ~768px. For 3 or 2 cards, scale the breakpoint accordingly.

**Don't** invent a `2×2` intermediate stage when going from 1-up to 4-up — it's a stale halfway point and the user has explicitly rejected it.

### 3.2 Section header

Page-level section header sits above content blocks.

```html
<h1 class="text-3xl font-semibold tracking-tight text-gray-900">Section title</h1>
<p class="text-sm text-gray-600 mt-1">Optional subtitle / context</p>
```

When the displayed data isn't what the user asked for (e.g. fallback to latest available month), say so explicitly in the subtitle: `"Showing latest available month (April 2026)"`.

### 3.3 Bottom-pinned linkouts

Inside a card with `flex flex-col h-full`, the ghost button (or anything pinned to the bottom) goes in a wrapper:

```html
<div class="mt-auto pt-6">
  <!-- ghost button or footer block -->
</div>
```

This guarantees the buttons line up across cards in a grid even when the cards have different content heights.

### 3.4 Page header

Every top-level tab leads with a section title in identical typography (§1.2 Page title) and a **dynamic subtitle** that reflects the current scope of what's shown.

```html
<div id="…-header" class="mb-6"></div>
```

Render via JS so the subtitle can re-render on filter change:

```js
function renderTransactionsHeader() {
  const el = document.getElementById('transactions-header');
  el.innerHTML = `
    <h1 class="text-3xl font-semibold tracking-tight text-gray-900">Transactions</h1>
    <p class="text-sm text-gray-600 mt-1">${escHtml(subtitleFromFilters())}</p>
  `;
}
```

Subtitle composition:
- No filters → fallback ("All transactions", "This Month's Snapshot", etc.)
- One or more filters → `Cat · May 2026 · matching "amazon"` (joined with ` · `)
- Fallback / disambiguation contexts ("Showing latest available month") — say it explicitly here, never silently

Re-call the render on every filter change so the subtitle stays accurate without the user wondering what's currently scoped.

---

## 4. Behavioral patterns

### 4.1 Synthesized insight copy

Prefer one decisive sentence over raw deltas. The "smart message" on Overview Card 1 is the model: `"12% more than last month"` or `"On pace with last month"`, not two numbers and a delta column.

When the comparison is partial-month-to-partial-month (current MTD vs same window of last month), say so via a tooltip — don't make the user infer it.

### 4.2 Always-on comparisons

Comparisons (vs last month, vs 3-month average) are visible by default. **Don't add a "compare" toggle**. Instead, surface the comparison directly in the value, the message, or as a peer card.

### 4.3 Cross-tab navigation

Tabs don't share URL state. To navigate from one tab to another with pre-applied filters or scope hints:

```js
function goToTransactionsCurrent(snap) {
  window.moneyHabitsNav = { tab: 'transactions', year_month: snap.month };
  showTab('transactions');
}
```

The destination tab reads `window.moneyHabitsNav` on activation, applies the filters, then nulls the state. Never set DOM filter values from outside the destination tab's own init code.

### 4.4 Empty / insufficient-data states

Always render the card surface and label. Swap the value to the em-dash placeholder with a `title` tooltip explaining why. Hide the ghost button in this state.

The page layout must remain predictable regardless of data availability — never collapse a card or rearrange the grid based on what data exists.

### 4.5 Tooltips for fine print

Anything that's "nice to know but not the headline" goes in a tooltip:
- Default behaviors ("Excludes fixed expenses like rent by default. Configurable in Habits.")
- Date-range disambiguation ("Compares May 1–8 to April 1–8 spending")
- Reasons for missing values ("Need 3 prior months")

For icon-anchored tooltips (the most common case), use `infoTooltip(text)` (§2.3) — the styled popover. The native browser tooltip (`title=`) is reserved for the em-dash placeholder where the trigger is the value itself, not an icon.

Tooltip copy is one sentence, ends in a period, no markdown. Keep it scannable in the bubble's ~14rem width.

**Don't** add explanatory paragraphs as visible card footers — they bloat the surface and compete with primary content.

---

## 5. Engineering conventions

### 5.1 Tailwind discipline

- All typography, spacing, and color come from Tailwind utility classes. No inline `style` for these properties.
- One exception: chart container heights use inline `style="height:Xpx"` because Plotly requires a definite height to render.
- `static/css/tailwind.css` is **pre-built** — new utility classes silently no-op until you rebuild:

```bash
npx -y tailwindcss@3.4.19 -i tailwind.input.css -o static/css/tailwind.css --minify
```

After any code change that introduces a new utility class, rebuild and verify: `grep <new-class> static/css/tailwind.css`. If the grep is empty, the class isn't loaded.

### 5.2 JS color access

When JS needs a raw color value (Plotly trace colors, dynamically-set styles), DO NOT hardcode hex. Read the CSS custom property:

```js
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
}
const accent = token('color-accent-500');
```

Tokens live in `static/css/style.css :root`. Add new tokens there in lockstep with `tailwind.config.js`.

### 5.3 Responsive

- Mobile-first. Use `md:` (768px) and `lg:` (1024px) prefixes only.
- Outer container is `max-w-6xl` (1152px). Don't bypass it.
- For multi-card grids, pick a single breakpoint that flips from stacked to full layout. No intermediate `2×2` stages unless explicitly designed.

### 5.4 Iconography

Two icon channels, used for distinct purposes — don't mix.

**UI affordances** — inline SVG:
- Inline SVG only — don't add an icon library.
- Heroicons-style outline or filled.
- 14×14 (`w-3.5 h-3.5`) for inline icons next to text.
- 16×16 (`w-4 h-4`) for standalone interactive icons (rare — most click-through is via ghost button).

**Category leaf identity** — native emoji (§1.5):
- Always wrapped in `<span class="cat-emoji">…</span>` so the OS color-emoji font wins over `Inter`.
- Always sourced from the `CATEGORY_EMOJI` table — never inlined ad-hoc.
- Never SVG'd, never Twemoji'd, never an `<img>`. Native Unicode keeps the OS rendering pipeline in charge and stays accessible to screen readers.
- Don't put emoji in a `<select><option>` — rendering inside form controls is inconsistent across browsers; use a real chip or button instead.

---

## 6. Anti-patterns (DON'T)

| Don't | Use instead |
|---|---|
| Filled accent CTA inside a card (`bg-accent-500 text-white`) | Ghost button (§2.2) |
| Inline text link inside a card (`text-accent-600 hover:text-accent-700`) | Ghost button |
| Bare `→` chevron icon as a click target | Ghost button with `→` in label |
| Footer paragraph of explanatory copy | Tooltip on info icon (§4.5) |
| Nested cards / "demoted" reference strip | Equal-weight peer cards in a grid (§3.1) |
| Hardcoded hex code in JS or HTML | CSS custom property + `token()` helper (§5.2) |
| New `text-{n}xl` sizes introduced ad-hoc | Stick to the scale in §1.2 |
| Loading state without a rendered card surface | Render the card with em-dash placeholder (§2.4) |
| Compare-mode toggle that hides comparison data when off | Always-on comparison (§4.2) |
| Setting filter DOM values from outside the destination tab | `window.moneyHabitsNav` + tab-side init read (§4.3) |
| `2×2` intermediate grid stage between mobile and desktop | Single breakpoint flip (§5.3) |
| Adding a Tailwind class without rebuilding | Always rebuild after adding (§5.1) |
| Hardcoded `bg-{family}-100` for a category | `catChipStyle(cat)` inline style (§1.4) |
| Bare `escHtml(cat)` for a category label | `catLabelHtml(cat)` so emoji renders (§1.5) |
| Twemoji / `<img>` for category emoji | Native Unicode + `.cat-emoji` (§5.4) |
| Long `<select>` populated with all months | Native `<input type="month">` |
| Section title without a dynamic subtitle | Always render scope context (§3.4) |
| `bg-accent-50 text-accent-700` chip for category | Category chip with `catChipStyle()` (§2.6) |
| Colored dot + chip on the same surface | Pick one — chip carries hue, drop the dot (§2.6) |
| Native `title=` tooltip on an info icon | `infoTooltip(text)` styled popover (§2.3) |
| `cursor-help` (question-mark cursor) on an info icon | Default cursor; the icon is signal enough (§2.3) |
