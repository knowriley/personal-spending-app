// Set role + aria-label on a chart container so screen readers announce the
// visualization with a meaningful summary instead of an empty <div>. Call
// after each chart render so the label reflects the current state.
function setChartA11y(elId, label) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
}

function fmt(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Active persona + cached static-JSON fetch ────────────────────────────────
// v2 ships a per-persona static JSON tree under /api/{persona}/. Active persona
// is held in localStorage (per-device) — there is no server-side persona state.
// fetchJsonCached() memoizes responses so re-renders + cross-tab lookups don't
// re-fetch; a persona switch calls clearJsonCache() before re-rendering.
const PERSONA_KEY = 'mh-active-persona';
let _activePersona = null;
function getActivePersona() {
  if (_activePersona) return _activePersona;
  let key = null;
  try { key = localStorage.getItem(PERSONA_KEY); } catch (e) { /* private mode */ }
  _activePersona = key || 'student';
  return _activePersona;
}
function setActivePersona(key) {
  _activePersona = key;
  try { localStorage.setItem(PERSONA_KEY, key); } catch (e) { /* private mode */ }
}

const _jsonCache = new Map();
function clearJsonCache() { _jsonCache.clear(); }
function fetchJsonCached(file) {
  const url = `/api/${getActivePersona()}/${file}`;
  let p = _jsonCache.get(url);
  if (p) return p;
  p = fetch(url).then(r => r.json());
  _jsonCache.set(url, p);
  return p;
}
// Persona-agnostic fetch (used by the dataset list itself).
function fetchPersonasJson() {
  return fetch('/api/personas.json').then(r => r.json());
}

// Mirrors build_static.scope_slug — maps (level, category) → the file-name slug
// the static tree uses (e.g. ('parent', 'Food & Drink') → 'parent-food-and-drink').
function scopeSlug(level, category) {
  if (level === 'all') return 'all';
  const s = (category || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip combining marks
    .toLowerCase().replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${level}-${s}`;
}

// Pick the static monthly file the Habits chart needs for (scope, view) — the
// chart is always monthly. Stacked variants pull the by-parent (all) or
// by-child (parent) shapes; everything else is the single-series scope file.
function habitsMonthlyFile(level, category, view) {
  if (level === 'all')    return view === 'stacked' ? 'monthly-all-month-by-parent.json' : 'monthly-all-month.json';
  if (level === 'parent') return view === 'stacked' ? `monthly-${scopeSlug(level, category)}-month-by-child.json` : `monthly-${scopeSlug(level, category)}-month.json`;
  return `monthly-${scopeSlug(level, category)}-month.json`;
}

// Filter a periods array (each row has `period` = "YYYY-MM") to the YYYY-MM-DD
// start/end window. The static monthly files carry the full history; the
// frontend slices to the active timeframe.
function filterPeriodsByRange(periods, start, end) {
  if (!start && !end) return periods;
  const sM = start ? start.slice(0, 7) : '';
  const eM = end   ? end.slice(0, 7)   : '';
  return periods.filter(p => (!sM || p.period >= sM) && (!eM || p.period <= eM));
}

// ── Custom DOM tooltip ────────────────────────────────────────────────────
// Drives a single #ct-tip element from mouse events. Now used only by the
// hand-rolled SVG radial chart (renderHabitsRadial → showCustomTooltip); the
// Chart.js charts use native tooltips (#cjs-tip). The other tip*HTML builders
// are kept but dormant. Per-chart `tip*HTML` builders produce the card content.
const TIP = { el: null, padding: 12 };

function showCustomTooltip(html, mouseEvent) {
  TIP.el ??= document.getElementById('ct-tip');
  if (!TIP.el || !mouseEvent || !html) return;
  TIP.el.innerHTML = html;
  TIP.el.classList.remove('hidden');
  positionCustomTooltip(mouseEvent);
}

function positionCustomTooltip(mouseEvent) {
  if (!TIP.el || TIP.el.classList.contains('hidden')) return;
  const rect = TIP.el.getBoundingClientRect();
  const vw = window.innerWidth;
  // Default: above-right of cursor; flip to left / below when overflowing.
  let left = mouseEvent.clientX + TIP.padding;
  let top  = mouseEvent.clientY - rect.height - TIP.padding;
  if (left + rect.width > vw - 8) left = mouseEvent.clientX - rect.width - TIP.padding;
  if (top < 8)                    top  = mouseEvent.clientY + TIP.padding;
  TIP.el.style.left = left + 'px';
  TIP.el.style.top  = top  + 'px';
}

function hideCustomTooltip() {
  TIP.el ??= document.getElementById('ct-tip');
  TIP.el?.classList.add('hidden');
}

// Card primitives — each builder uses these so the visual style stays uniform.
function tipCard({ accentSlug = '', title = '', meta = '', value = '', rows = [] }) {
  const accent = accentSlug
    ? ` data-accent style="--ct-accent: var(--color-cat-${accentSlug}-mid);"`
    : '';
  const titleHtml = title ? `<div class="ct-tip-title">${title}</div>` : '';
  const metaHtml  = meta  ? `<div class="ct-tip-meta">${escHtml(meta)}</div>` : '';
  const valueHtml = value ? `<div class="ct-tip-value">${escHtml(value)}</div>` : '';
  const rowsHtml  = rows.map(r => `<div class="ct-tip-row"><span class="lbl">${escHtml(r.lbl)}</span><span>${escHtml(r.val)}</span></div>`).join('');
  return `<div class="ct-tip"${accent}>${titleHtml}${metaHtml}${valueHtml}${rowsHtml}</div>`;
}

// Render a category badge (emoji + name) for use inside .ct-tip-title.
function tipCatBadge(name) {
  const e = catEmoji(name);
  const emoji = e ? `<span class="cat-emoji" aria-hidden="true">${e}</span>` : '';
  return `${emoji}${escHtml(name)}`;
}

// ── Chart.js shared infrastructure ───────────────────────────────────────────
// Every non-radial chart renders via Chart.js (M8). These helpers mirror the
// Global defaults set once at boot, a per-render layout fragment, a
// canvas-lifecycle registry, and a native-tooltip styler that reuses tipCard()
// so Chart.js tooltips match the shared card look.

let _chartDefaultsInited = false;
function initChartDefaults() {
  if (_chartDefaultsInited || typeof Chart === 'undefined') return;
  _chartDefaultsInited = true;
  Chart.defaults.font.family = 'Inter, ui-sans-serif, system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = token('color-gray-700');
  Chart.defaults.borderColor = token('color-gray-100');
  Chart.defaults.responsive = true;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.display = false;   // legends rarely earn their slot
  Chart.defaults.animation.duration = 200;          // snappier than the 1000ms default
  // datalabels is registered globally but OFF by default — only the drill-down
  // donut opts in (per-chart options.plugins.datalabels.display = true).
  if (window.ChartDataLabels) {
    Chart.register(window.ChartDataLabels);
    Chart.defaults.set('plugins.datalabels', { display: false });
  }
}

// Per-render layout fragment (NOT memoized — reads window.innerWidth so the
// mobile/desktop split tracks viewport changes). Each chart merges its own
// scale overrides on top: `{ ...chartLayout(), scales: { x: {...base.scales.x, …} } }`.
function chartLayout() {
  const isMobile = window.innerWidth < 768;
  return {
    layout: {
      padding: isMobile ? { left: 4, right: 8, top: 8, bottom: 4 }
                        : { left: 8, right: 16, top: 12, bottom: 8 },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: token('color-gray-500'), font: { size: isMobile ? 11 : 12 } },
      },
      y: {
        grid: { color: token('color-gray-100') },
        ticks: {
          color: token('color-gray-500'),
          font: { size: isMobile ? 11 : 12 },
          callback: (v) => fmt(v),
        },
      },
    },
  };
}

// Chart.js needs a <canvas>; the chart containers are <div>s. Find-or-create
// a single canvas child of the container and return it (Chart accepts the element).
function getChartCanvas(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  let canvas = el.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    el.appendChild(canvas);
  }
  return canvas;
}

// Instance registry. Re-rendering is frequent here (month/scope toggles), and
// `new Chart()` over a live instance on the same canvas leaks a resize observer.
// Always destroy before re-creating. When a render path resets the container's
// innerHTML (e.g. renderOverviewLineChart), call destroyChart() BEFORE the reset
// so the prior canvas isn't orphaned with an observer still attached.
const _charts = {};
function mountChart(containerId, config) {
  if (typeof Chart === 'undefined') return null;
  initChartDefaults();
  _charts[containerId]?.destroy();
  const canvas = getChartCanvas(containerId);
  if (!canvas) return null;
  _charts[containerId] = new Chart(canvas, config);
  return _charts[containerId];
}
function destroyChart(containerId) {
  _charts[containerId]?.destroy();
  delete _charts[containerId];
}

// Native-tooltip styler. Returns a Chart.js `external` handler that renders the
// shared tipCard() markup into #cjs-tip (separate from the radial chart's #ct-tip).
// `buildSpec(context)` maps the hovered dataPoints → a tipCard spec
// ({ accentSlug, title, meta, value, rows }); return null to suppress.
function makeTipExternal(buildSpec) {
  return (context) => {
    const tip = (makeTipExternal._el ??= document.getElementById('cjs-tip'));
    if (!tip) return;
    const tt = context.tooltip;
    if (!tt || tt.opacity === 0) { tip.classList.add('hidden'); return; }
    const spec = buildSpec(context);
    if (!spec) { tip.classList.add('hidden'); return; }
    tip.innerHTML = tipCard(spec);
    tip.classList.remove('hidden');
    // caretX/Y are canvas-relative; convert to viewport coords.
    const rect = context.chart.canvas.getBoundingClientRect();
    positionCjsTip(tip, rect.left + tt.caretX, rect.top + tt.caretY);
  };
}

// Force-hide the Chart.js native tooltip element. Chart.js only hides it on its
// own mouseleave; if a chart is re-rendered or torn down mid-hover the tooltip
// can be stranded on screen — call this whenever the drill-down re-renders.
function hideCjsTip() {
  (makeTipExternal._el ??= document.getElementById('cjs-tip'))?.classList.add('hidden');
}

// Same flip logic as positionCustomTooltip, but driven by explicit viewport
// coords (the Chart.js caret) rather than a mouse event.
function positionCjsTip(tip, x, y) {
  const r = tip.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, pad = 12;
  let left = x + pad;
  let top  = y - r.height - pad;
  if (left + r.width > vw - 8) left = x - r.width - pad;   // flip left
  if (left < 8) left = 8;
  if (top < 8) top = y + pad;                              // flip below
  if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
  tip.style.left = left + 'px';
  tip.style.top  = top  + 'px';
}

// ── Navigation ────────────────────────────────────────────────────────────────
let activeTab = 'overview';
let habitsInited = false;

// Per-tab page header (large title + supporting subtitle in the secondary nav).
// Title/subtitle text is live-updated by each tab's render path; showTab paints
// an immediate placeholder so the bar never reads as the wrong tab.
function setPageHeader(title, subtitle = '') {
  const titleEl = document.getElementById('page-title');
  const subEl   = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = title;
  // &nbsp; preserves vertical space when subtitle is blank.
  if (subEl)   subEl.innerHTML = subtitle ? escHtml(subtitle) : '&nbsp;';
}

// Map the URL hash to a tab name (or null if it isn't one of ours).
function tabFromHash() {
  const h = (location.hash || '').replace(/^#/, '');
  return ['overview', 'habits', 'transactions'].includes(h) ? h : null;
}

function showTab(name, opts = {}) {
  activeTab = name;
  // Close the Habits page-header chip dropdown on any tab change so leaving
  // Habits with the panel open doesn't leave it visible elsewhere.
  document.getElementById('hc-chip-panel')?.classList.add('hidden');
  if (name === 'overview') {
    if (overviewSnapshot) renderOverviewHeader(overviewSnapshot);
    else setPageHeader('Overview', '');
    document.getElementById('ov-month-panel')?.classList.add('hidden');
  }
  if (name === 'habits')       setHabitsPageHeader();
  if (name === 'transactions') {
    document.getElementById('ov-month-panel')?.classList.add('hidden');
    renderTransactionsHeader();
  }
  const tabLabel = name.charAt(0).toUpperCase() + name.slice(1);
  document.title = `MoneyHabits — ${tabLabel}`;
  // Mobile sticky bar shows just the tab name.
  const stickyTitle = document.getElementById('sticky-title');
  if (stickyTitle) stickyTitle.textContent = tabLabel;

  ['overview', 'habits', 'transactions'].forEach(t => {
    const sec = document.getElementById('section-' + t);
    if (sec) sec.classList.toggle('hidden', t !== name);
  });
  // Active state on every nav button (side rail + bottom tab bar).
  document.querySelectorAll('[data-tab]').forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-current', active ? 'page' : 'false');
  });

  // Start the new tab at the top so the large title reads fresh.
  const scroller = document.getElementById('app-scroll');
  if (scroller) scroller.scrollTop = 0;

  // Keep the URL hash in sync (drives back/forward via popstate below).
  if (opts.updateHash !== false && tabFromHash() !== name) {
    history.pushState({ tab: name }, '', '#' + name);
  }

  if (name === 'overview')     initOverviewTab();
  if (name === 'habits' && !habitsInited) {
    habitsInited = true;
    initDashboard();
  }
  if (name === 'transactions') renderTransactionsTab();
}

// Large-title scroll-shrink is mobile-only (desktop nav lives in the side rail,
// so the title is static there). Re-wire on breakpoint change.
let _largeTitleCleanup = null;
function syncHeaderScroll() {
  const scroller   = document.getElementById('app-scroll');
  const largeTitle = document.getElementById('large-title-block');
  const stickyFade = document.getElementById('sticky-fade');
  if (!scroller || !largeTitle || !stickyFade || !window.MoneyHabitsIOS) return;
  if (_largeTitleCleanup) { _largeTitleCleanup(); _largeTitleCleanup = null; }
  if (window.innerWidth < 768) {
    _largeTitleCleanup = MoneyHabitsIOS.initLargeTitleScroll(scroller, { largeTitle, stickyBar: stickyFade });
  } else {
    // Desktop: clear any inline styles a prior mobile session left behind.
    largeTitle.style.opacity = '';
    largeTitle.style.transform = '';
    stickyFade.style.opacity = '';
    stickyFade.style.pointerEvents = '';
  }
}

// Nav buttons (side rail + bottom tab bar) → switch tab.
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// Back / forward → restore the tab without pushing a fresh history entry.
window.addEventListener('popstate', e => {
  const t = (e.state && e.state.tab) || tabFromHash() || 'overview';
  showTab(t, { updateHash: false });
});

// Wire the large-title scroll-shrink to the current breakpoint, re-wiring on change.
syncHeaderScroll();
window.matchMedia('(min-width: 768px)').addEventListener('change', syncHeaderScroll);


// ── Dropdown a11y helper ─────────────────────────────────────────────────────
// Wires the standard menu/listbox a11y contract to a button + panel pair:
//   • aria-haspopup + aria-expanded toggling
//   • Escape closes and restores focus to the trigger
//   • ArrowDown on the trigger opens and focuses the first item
//   • ArrowUp/ArrowDown/Home/End cycle focus among items inside the panel
// Idempotent — `data-dropdown-wired` guards against double-binding when a
// re-rendered button (e.g. the Habits chip) is wired again.
function wireDropdown(btn, panel, opts = {}) {
  if (!btn || !panel) return;
  btn.setAttribute('aria-haspopup', opts.haspopup || 'listbox');
  if (!btn.hasAttribute('aria-expanded')) btn.setAttribute('aria-expanded', 'false');
  const focusItems = () => Array.from(
    panel.querySelectorAll('button:not([disabled]), [role="menuitem"], [role="option"], [tabindex="0"]')
  ).filter(el => el.offsetParent !== null);
  if (!btn.dataset.dropdownWired) {
    btn.dataset.dropdownWired = '1';
    btn.addEventListener('keydown', e => {
      const open = !panel.classList.contains('hidden');
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        panel.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
      } else if (e.key === 'ArrowDown' && !open) {
        e.preventDefault();
        panel.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        setTimeout(() => focusItems()[0]?.focus(), 0);
      }
    });
  }
  if (!panel.dataset.dropdownWired) {
    panel.dataset.dropdownWired = '1';
    panel.addEventListener('keydown', e => {
      const items = focusItems();
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        panel.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1].focus();
      }
    });
    // Mirror the panel's hidden state into aria-expanded so external toggles
    // (existing click handlers) stay in sync without each having to remember.
    new MutationObserver(() => {
      btn.setAttribute('aria-expanded', panel.classList.contains('hidden') ? 'false' : 'true');
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }
}


// ── Profile / dataset switcher ───────────────────────────────────────────────
// A Notion-style workspace switcher: the desktop rail's #profile-btn shows the
// active persona (badge + name + chevron); the mobile sticky header shows a
// compact initial badge (#profile-badge-mobile). Both open the shared
// #profile-panel dropdown (positioned near the trigger), listing the personas.
// Switching POSTs the new key and reloads (in-place re-render is a later task).
// Settings proper (About, etc.) is deferred.
const _profileInitial = (key) => (key || '?').charAt(0).toUpperCase();

function positionProfilePanel(anchor) {
  const panel = document.getElementById('profile-panel');
  if (!panel || !anchor) return;
  panel.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const pw = panel.offsetWidth;
  // Default left-aligned under the trigger; flip to right-aligned if it would
  // overflow the viewport (the mobile badge sits at the top-right).
  let left = r.left;
  if (left + pw > window.innerWidth - 8) left = Math.max(8, r.right - pw);
  panel.style.left = left + 'px';
  panel.style.top  = (r.bottom + 6) + 'px';
}
function closeProfileMenu() {
  const panel = document.getElementById('profile-panel');
  if (panel) panel.classList.add('hidden');
  document.getElementById('profile-btn')?.setAttribute('aria-expanded', 'false');
  document.getElementById('profile-badge-mobile')?.setAttribute('aria-expanded', 'false');
}
function toggleProfileMenu(anchor) {
  const panel = document.getElementById('profile-panel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    positionProfilePanel(anchor);
    anchor?.setAttribute('aria-expanded', 'true');
  } else {
    closeProfileMenu();
  }
}

async function initProfileSwitcher() {
  // /api/personas.json is persona-agnostic — it's at the API root, not under
  // a persona prefix. It lists [{key,label}]; "active" comes from localStorage.
  let datasets = [];
  try { datasets = await fetchPersonasJson(); } catch (e) { /* offline */ }
  const activeKey = getActivePersona();
  const active    = datasets.find(d => d.key === activeKey) || datasets[0];

  // Fill the triggers with the active persona.
  if (active) {
    const nameEl  = document.getElementById('profile-name');
    const badgeEl = document.getElementById('profile-badge');
    const mBadge  = document.getElementById('profile-badge-mobile')?.querySelector('span');
    if (nameEl)  nameEl.textContent  = active.label;
    if (badgeEl) badgeEl.textContent = _profileInitial(active.key);
    if (mBadge)  mBadge.textContent  = _profileInitial(active.key);
  }

  // Build the dropdown list.
  const panel = document.getElementById('profile-panel');
  if (panel) {
    panel.innerHTML = `<p class="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Dataset</p>`
      + datasets.map(d => {
          const isActive = d.key === activeKey;
          return `
        <button type="button" data-key="${d.key}" class="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-neutral-50 focus:outline-none focus:bg-neutral-50">
          <span class="w-6 h-6 rounded-md bg-neutral-100 text-neutral-600 text-xs font-semibold flex items-center justify-center shrink-0" aria-hidden="true">${_profileInitial(d.key)}</span>
          <span class="flex-1 min-w-0 text-sm truncate ${isActive ? 'font-semibold text-neutral-900' : 'text-neutral-700'}">${escHtml(d.label)}</span>
          ${isActive ? '<span class="text-accent-700 shrink-0" aria-label="active">✓</span>' : ''}
        </button>`;
        }).join('');

    panel.querySelectorAll('button[data-key]').forEach(item => {
      item.addEventListener('click', async () => {
        const key = item.dataset.key;
        if (key === getActivePersona()) { closeProfileMenu(); return; }
        setActivePersona(key);
        closeProfileMenu();
        await resetAndReload();
      });
    });
  }

  // Wire the triggers + dismissal (outside-click / Escape).
  document.getElementById('profile-btn')?.addEventListener('click', e => { e.stopPropagation(); toggleProfileMenu(e.currentTarget); });
  document.getElementById('profile-badge-mobile')?.addEventListener('click', e => { e.stopPropagation(); toggleProfileMenu(e.currentTarget); });
  document.addEventListener('click', e => {
    const p = document.getElementById('profile-panel');
    if (p && !p.classList.contains('hidden') && !p.contains(e.target)) closeProfileMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfileMenu(); });
}


// ── Overview tab ─────────────────────────────────────────────────────────────

// Reads a CSS custom property value from :root. Source of truth for these
// tokens is tailwind.config.js + static/css/style.css :root block.
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
}

function hexToRgba(hex, alpha) {
  const m = hex.replace('#', '').match(/.{1,2}/g);
  if (!m) return hex;
  const [r, g, b] = m.map(h => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function prevMonthOf(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return '';
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Range label for the 3-month-avg tooltip — mirrors data_processor's
// [m-3, m-2, m-1] window. Collapses the year when start and end share one.
function threeMonthAvgRangeLabel(ym) {
  const end   = prevMonthOf(ym);
  const start = prevMonthOf(prevMonthOf(end));
  if (!start || !end) return '';
  const startFull = formatMonthLabel(start);
  const endFull   = formatMonthLabel(end);
  if (start.slice(0, 4) === end.slice(0, 4)) {
    return `${startFull.split(' ')[0]} – ${endFull}`;
  }
  return `${startFull} – ${endFull}`;
}

const OVERVIEW_DEFAULT_EXCLUDES = ['Rent'];

let overviewInited   = false;
let overviewSnapshot = null;
let overviewMonths   = [];
let overviewOverlay  = false;   // cumulative chart: false = single line, true = overlay last month

async function initOverviewTab() {
  if (overviewInited) return;
  overviewInited = true;

  // Load the dataset's month list once for the header dropdown.
  try {
    overviewMonths = await fetchJsonCached('months.json');
  } catch (e) { /* dropdown falls back to just the active month */ }

  await loadAndRenderOverview();
}

// Re-entrant: invoked on initial load (no month) and again whenever the user
// picks a month from the header dropdown.
async function loadAndRenderOverview(month) {
  let snap;
  try {
    // Static tree: one file with all months keyed inside; pick the requested
    // month (default = most recent, i.e. the first key by definition of the
    // build's newest-first emission).
    const [snapFile] = await Promise.all([
      fetchJsonCached('overview-snapshot.json'),
      loadCategoryMeta(),
    ]);
    const months = snapFile.months || {};
    const target = (month && months[month]) ? month : Object.keys(months)[0];
    snap = months[target];
    if (!snap) throw new Error('overview snapshot empty');
  } catch (e) {
    console.error('Overview snapshot fetch failed', e);
    return;
  }
  overviewSnapshot = snap;

  // Top categories for the active month, excluding default exclusions (default
  // file already excludes 'Rent'; if our exclude list ever diverges we'd need
  // a richer build, but it doesn't today).
  let topCats = [];
  try {
    const tc = await fetchJsonCached('top-categories-default.json');
    topCats = (tc.months && tc.months[snap.month]) || [];
  } catch (e) { /* swallow — render empty */ }
  topCats = (topCats || []).slice(0, 3);

  overviewOverlay = false;   // each month opens with the single-line default
  renderOverviewHeader(snap);
  renderCard1(snap);
  renderCard4(topCats, snap.month);
  renderOverviewLineChart(snap);
  wireOverviewActions(snap);
}

function setOverviewMonth(month) {
  document.getElementById('ov-month-panel')?.classList.add('hidden');
  loadAndRenderOverview(month);
}

// Returns { text, direction } where direction is:
//   'up'   → spending is HIGHER (bad signal — utility-red)
//   'down' → spending is LOWER  (good signal — utility-green)
//   'flat' → on pace             (neutral)
// Or null when there's no comparable last-month anchor.
function computeSmartMessage(snap) {
  if (snap.last_month_mtd == null || snap.last_month_mtd <= 0) return null;

  const dLm = (snap.this_month_total - snap.last_month_mtd) / snap.last_month_mtd;
  const lastMonthLabel = formatMonthLabel(prevMonthOf(snap.month));

  // Anomaly check: was last month itself an outlier vs its own 3-mo average?
  let lmAnomaly = null;
  if (snap.last_month_total != null
      && snap.last_month_3mo_avg != null
      && snap.last_month_3mo_avg > 0) {
    lmAnomaly = Math.abs(snap.last_month_total - snap.last_month_3mo_avg) / snap.last_month_3mo_avg;
  }

  if (lmAnomaly !== null
      && lmAnomaly >= 0.25
      && snap.three_month_avg_mtd != null
      && snap.three_month_avg_mtd > 0) {
    const dAvg = (snap.this_month_total - snap.three_month_avg_mtd) / snap.three_month_avg_mtd;
    const pct = Math.round(Math.abs(dAvg) * 100);
    const dir = dAvg >= 0 ? 'more' : 'less';
    return {
      text: `${pct}% ${dir} than your 3-month average`,
      direction: dAvg >= 0 ? 'up' : 'down',
    };
  }

  if (Math.abs(dLm) < 0.05) return { text: `On pace with ${lastMonthLabel}`, direction: 'flat' };

  const pct = Math.round(Math.abs(dLm) * 100);
  const dir = dLm >= 0 ? 'more' : 'less';
  return {
    text: `${pct}% ${dir} than ${lastMonthLabel}`,
    direction: dLm >= 0 ? 'up' : 'down',
  };
}

// Inline trend icon for the smart message — straight diagonal arrow (no
// trend-line curve). `direction` is 'up' | 'down' | 'flat'; flat returns no
// icon (the wording "On pace…" carries enough meaning without one).
function trendIconHtml(direction) {
  if (direction === 'up') {
    return `<svg class="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 13 13 3"/>
      <path d="M6 3h7v7"/>
    </svg>`;
  }
  if (direction === 'down') {
    return `<svg class="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 3 13 13"/>
      <path d="M13 6v7H6"/>
    </svg>`;
  }
  return '';
}

// Custom HTML override of the secondary nav title — bypasses setPageHeader's
// plain-text path so we can embed the month-picker chip and a small eyebrow.
// Mirrors setHabitsPageHeader's approach.
function renderOverviewHeader(snap) {
  if (!snap) return;
  const titleEl = document.getElementById('page-title');
  const subEl   = document.getElementById('page-subtitle');
  if (!titleEl || !subEl) return;

  const monthLabel = formatMonthLabel(snap.month);

  titleEl.innerHTML =
      `<span class="block text-base font-semibold text-neutral-600 mb-1">Overview</span>`
    + `Your Spending Snapshot for `
    + `<button id="ov-month-btn" type="button"`
    + ` class="cursor-pointer hover:opacity-80 underline decoration-solid underline-offset-4`
    + ` focus:outline-none focus:ring-2 focus:ring-accent-700 rounded-sm"`
    + ` aria-haspopup="listbox" aria-expanded="false">`
    + escHtml(monthLabel)
    + `</button>`;

  subEl.innerHTML = '&nbsp;';

  buildOverviewMonthPanel(snap.month);
}

// Build / re-build the month dropdown anchored under the chip. Re-rendered
// on every snap change so the active-month highlight stays accurate.
function buildOverviewMonthPanel(activeMonth) {
  const titleEl = document.getElementById('page-title');
  const wrapper = titleEl?.parentElement; // .relative inline-block in base.html
  const chip    = document.getElementById('ov-month-btn');
  if (!wrapper || !chip) return;

  let panel = document.getElementById('ov-month-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ov-month-panel';
    panel.className = 'hidden absolute z-30 mt-2 min-w-[12rem] max-h-[60vh] overflow-y-auto bg-white border border-neutral-200 rounded-xl shadow-lg py-1';
    wrapper.appendChild(panel);
  }

  // Always include the active month in case the dataset's month list missed it.
  const months = (overviewMonths.length ? overviewMonths.slice() : []);
  if (!months.includes(activeMonth)) months.push(activeMonth);
  months.sort();

  panel.innerHTML = '';
  months.slice().reverse().forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    const isActive = m === activeMonth;
    b.className = ['block w-full text-left text-sm px-3 py-1.5 hover:bg-neutral-50 whitespace-nowrap',
                   isActive ? 'bg-neutral-100 text-neutral-900 font-semibold' : 'text-neutral-700'].join(' ');
    b.textContent = formatMonthLabel(m);
    b.addEventListener('click', () => setOverviewMonth(m));
    panel.appendChild(b);
  });

  // Anchor the panel under the chip's left edge / bottom (within the shared
  // .relative wrapper). offsetTop+offsetHeight puts it just below the button.
  panel.style.left = chip.offsetLeft + 'px';
  panel.style.top  = (chip.offsetTop + chip.offsetHeight + 4) + 'px';

  wireDropdown(chip, panel);
  if (!chip.dataset.ovToggleWired) {
    chip.dataset.ovToggleWired = '1';
    chip.addEventListener('click', e => {
      e.stopPropagation();
      // Mobile: a bottom sheet (the large title shrinks on scroll, so an
      // anchored dropdown is awkward). Desktop: the anchored dropdown.
      if (window.innerWidth < 768) { openOverviewMonthSheet(); return; }
      panel.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!panel.contains(e.target) && e.target !== chip) {
        panel.classList.add('hidden');
      }
    });
  }
}

// Mobile month picker — a bottom sheet listing the dataset's months, newest
// first, active one highlighted. Reads the current month from overviewSnapshot.
function openOverviewMonthSheet() {
  if (!window.MoneyHabitsIOS) return;
  const activeMonth = overviewSnapshot?.month;
  const months = (overviewMonths.length ? overviewMonths.slice() : []);
  if (activeMonth && !months.includes(activeMonth)) months.push(activeMonth);
  months.sort();

  const wrap = document.createElement('div');
  wrap.className = 'px-2 pb-4';
  months.slice().reverse().forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    const isActive = m === activeMonth;
    b.className = ['block w-full text-left px-3 py-3 rounded-lg',
                   isActive ? 'bg-neutral-100 text-neutral-900 font-semibold' : 'text-neutral-700 hover:bg-neutral-50'].join(' ');
    b.textContent = formatMonthLabel(m);
    b.addEventListener('click', () => { MoneyHabitsIOS.closeBottomSheet(); setOverviewMonth(m); });
    wrap.appendChild(b);
  });
  MoneyHabitsIOS.openBottomSheet({ title: 'Select month', content: wrap });
}

const OVERVIEW_INFO_ICON = `
  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"/>
  </svg>
`;

// Info-icon trigger + styled popover (.info-tt / .info-tt-bubble in style.css).
// Replaces native `title`-based tooltips so the cursor doesn't go question-mark
// and the bubble matches our visual language.
function infoTooltip(text, { ariaLabel = 'More information', align = 'center' } = {}) {
  const alignCls = align === 'right' ? ' info-tt-bubble--right' : '';
  return `<span class="info-tt shrink-0 text-neutral-400" tabindex="0" role="img" aria-label="${escHtml(ariaLabel)}">${OVERVIEW_INFO_ICON}<span class="info-tt-bubble${alignCls}">${escHtml(text)}</span></span>`;
}

// Link button — the only click-through type used inside content surfaces
// (Overview cards, future card-bottom CTAs). Inline / content-sized;
// underline on the label drops on hover, bg shifts to surface-recessed.
function linkButton(label, action) {
  return `
    <button type="button" data-overview-action="${action}"
      class="link-btn inline-flex items-center gap-1.5
             text-sm font-medium text-neutral-600
             bg-white rounded-lg
             px-3.5 py-2
             hover:bg-neutral-50 hover:text-neutral-700
             focus:outline-none focus:ring-2 focus:ring-accent-700
             transition-colors">
      <span class="link-btn-lbl underline decoration-solid underline-offset-2">${escHtml(label)}</span>
      <span aria-hidden="true">&rarr;</span>
    </button>
  `;
}

// Card-level shared classes (constants so all four cards stay in lockstep).
const CARD_SHELL = 'bg-white border border-neutral-200 rounded-lg p-6 h-full flex flex-col';
const CARD_LABEL = 'text-base font-semibold text-neutral-900';
const CARD_VALUE = 'text-6xl font-semibold tracking-tight text-neutral-900 mt-3 break-words';
const CARD_VALUE_MISS = 'text-6xl font-semibold tracking-tight text-neutral-500 mt-3 cursor-help';

function renderCard1(snap) {
  const card = document.getElementById('overview-card1');
  if (!card) return;

  const message = computeSmartMessage(snap);
  const monthLabel = formatMonthLabel(snap.month);
  const cardLabel = snap.is_partial ? `Spent so far in ${monthLabel}` : `Spent in ${monthLabel}`;

  // Color the smart message by direction: up = more spending = red,
  // down = less spending = green, flat = neutral. Trend icon mirrors color.
  const msgColor = message?.direction === 'up'   ? 'text-utility-red-700'
                 : message?.direction === 'down' ? 'text-utility-green-700'
                 :                                 'text-neutral-600';
  const messageHtml = message
    ? `<p class="text-sm font-medium mt-2 flex items-center gap-1.5 ${msgColor}">
        ${trendIconHtml(message.direction)}
        <span>${escHtml(message.text)}</span>
      </p>`
    : '';

  card.innerHTML = `
    <div class="${CARD_SHELL}">
      <p class="${CARD_LABEL}">${escHtml(cardLabel)}</p>
      <p class="${CARD_VALUE}">${fmt(snap.this_month_total)}</p>
      ${messageHtml}
      <div class="mt-auto pt-6">${linkButton('See transactions', 'tx-current')}</div>
    </div>
  `;
}

function renderCard4(topCats, month) {
  const el = document.getElementById('overview-card4');
  if (!el) return;

  const has = topCats && topCats.length > 0;
  const bodyHtml = has
    ? `<ul class="mt-3 space-y-2">${topCats.map(c =>
        `<li><span class="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full max-w-full truncate" style="${catChipStyle(c.category)}">${catLabelHtml(c.category)}</span></li>`
      ).join('')}</ul>`
    : `<p class="text-sm text-neutral-500 mt-3">No categories yet</p>`;

  const bottomHtml = has
    ? `<div class="mt-auto pt-6">${linkButton('Open in Habits', 'habits-month')}</div>`
    : '';

  const monthLabel = formatMonthLabel(month);
  el.innerHTML = `
    <div class="${CARD_SHELL}">
      <p class="${CARD_LABEL} flex items-center gap-1.5">
        <span>Top Categories in ${escHtml(monthLabel)}</span>
        ${infoTooltip("Excludes fixed expenses like rent by default. Configurable in Habits.", { align: 'right' })}
      </p>
      ${bodyHtml}
      ${bottomHtml}
    </div>
  `;
}

// One delegated listener for all four cards' ghost buttons.
function wireOverviewActions(snap) {
  const section = document.getElementById('section-overview');
  if (!section) return;
  section.querySelectorAll('[data-overview-action]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const action = el.dataset.overviewAction;
      if (action === 'tx-current')      goToTransactionsCurrent(snap);
      if (action === 'tx-prev-partial') goToTransactionsPrevPartial(snap);
      if (action === 'habits-3mo')      goToHabits('3mo');
      if (action === 'habits-month')    goToHabits({ month: snap.month });
    });
  });
}

// Cumulative chart heading. The overlay toggle (not the title) now carries the
// month-vs-month comparison, so the title just names the cumulative view.
function chartTitleFor(month) {
  return `Cumulative spend in ${formatMonthLabel(month)}`;
}

function renderOverviewLineChart(snap) {
  hideCustomTooltip();
  const container = document.getElementById('overview-chart-card');
  if (!container) return;

  // Destroy the prior instance BEFORE wiping the card, or the old canvas is
  // orphaned with a live resize observer (leak).
  destroyChart('overview-chart');

  const chartH = window.innerWidth < 768 ? 240 : 320;
  const lastLabel = formatMonthLabel(prevMonthOf(snap.month));
  const hasLast = !!(snap.last_cumulative && snap.last_cumulative.length);
  // Overlay toggle (only meaningful when there's a prior month to overlay).
  const toggleHtml = hasLast ? `
    <button type="button" id="ov-overlay-toggle" role="switch" aria-checked="${overviewOverlay}"
      class="flex items-center gap-2 shrink-0 focus:outline-none focus:ring-2 focus:ring-accent-700 rounded-full">
      <span class="text-xs text-neutral-500 whitespace-nowrap">Overlay ${escHtml(lastLabel)}</span>
      <span class="relative inline-block w-9 h-5 rounded-full transition-colors ${overviewOverlay ? 'bg-accent-700' : 'bg-neutral-300'}">
        <span class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${overviewOverlay ? 'translate-x-4' : ''}"></span>
      </span>
    </button>` : '';

  container.innerHTML = `
    <div class="flex items-center justify-between gap-3">
      <p class="text-base font-semibold text-neutral-900">${escHtml(chartTitleFor(snap.month))}</p>
      ${toggleHtml}
    </div>
    <div id="overview-chart" class="w-full mt-3" style="height:${chartH}px"></div>
  `;

  // Toggle flips overlay state and re-renders just the chart card.
  document.getElementById('ov-overlay-toggle')?.addEventListener('click', () => {
    overviewOverlay = !overviewOverlay;
    renderOverviewLineChart(snap);
  });

  const accentColor = token('color-accent-700');
  const greyColor   = token('color-gray-400');

  // Both lines share a 1..maxDays day-of-month axis; series are mapped onto that
  // index and padded with null past their last posted day.
  const [, snapMo] = (snap.month || '').split('-').map(Number);
  const monthName = (snapMo && snapMo >= 1 && snapMo <= 12) ? MONTH_LABELS[snapMo - 1] : '';
  const lastDayThis = snap.this_cumulative?.length ? snap.this_cumulative[snap.this_cumulative.length - 1].day : 0;
  const lastDayLast = snap.last_cumulative?.length ? snap.last_cumulative[snap.last_cumulative.length - 1].day : 0;
  const maxDays = Math.max(lastDayThis, lastDayLast, 28);
  const labels  = Array.from({ length: maxDays }, (_, i) => i + 1);

  const seriesByDay = (rows) => {
    const arr = Array(maxDays).fill(null);
    (rows || []).forEach(d => { if (d.day >= 1 && d.day <= maxDays) arr[d.day - 1] = d.total; });
    return arr;
  };

  const datasets = [];
  if (snap.this_cumulative?.length) {
    datasets.push({
      label: 'This month',
      data: seriesByDay(snap.this_cumulative),
      borderColor: accentColor, borderWidth: 2,
      backgroundColor: hexToRgba(accentColor, 0.08), fill: 'origin',
      pointRadius: 0, pointHoverRadius: 9,
      pointHoverBackgroundColor: accentColor,
      pointHoverBorderColor: token('color-white'), pointHoverBorderWidth: 2,
      tension: 0, spanGaps: true,
    });
  }
  // Last-month line only when the overlay toggle is on (single-line default).
  if (overviewOverlay && snap.last_cumulative?.length) {
    datasets.push({
      label: `Last month (${lastLabel})`,
      data: seriesByDay(snap.last_cumulative),
      borderColor: greyColor, borderWidth: 2, borderDash: [4, 3], fill: false,
      pointRadius: 0, pointHoverRadius: 9,
      pointHoverBackgroundColor: greyColor,
      pointHoverBorderColor: token('color-white'), pointHoverBorderWidth: 2,
      tension: 0, spanGaps: true,
    });
  }

  const base = chartLayout();
  mountChart('overview-chart', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...base,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { ...base.scales.x,
             ticks: { ...base.scales.x.ticks, maxRotation: 45, minRotation: 45,
                      callback: (v, i) => monthName ? `${monthName} ${labels[i]}` : String(labels[i]) } },
        y: { ...base.scales.y, position: 'right', beginAtZero: true,
             title: { display: true, text: 'Spend', color: token('color-gray-500'), font: { size: 12 } } },
      },
      plugins: {
        // No legend — single line by default; the overlay toggle + tooltip label
        // identify the dashed last-month line when shown.
        legend: { display: false },
        tooltip: { enabled: false, external: makeTipExternal(cjsTipOverviewCumul) },
      },
    },
  });
  setChartA11y('overview-chart', 'Cumulative spend chart, current month vs last month, line chart by day');
}

// Overview cumulative tooltip spec — "This month" shows the bare value; the muted
// "Last month" overlay is labeled inline.
function cjsTipOverviewCumul(ctx) {
  const dp = ctx.tooltip.dataPoints?.[0];
  if (!dp) return null;
  const isThis = dp.dataset.label === 'This month';
  const value = fmt(dp.parsed.y || 0);
  return {
    title: `Day ${dp.label}`,
    meta: dp.dataset.label || '',
    value: isThis ? value : `Last month: ${value}`,
  };
}

// Navigation helpers — set window.moneyHabitsNav, then switch tabs. Other tabs
// read the nav state when they activate.

function goToTransactionsCurrent(snap) {
  window.moneyHabitsNav = { tab: 'transactions', year_month: snap.month };
  showTab('transactions');
}

function goToTransactionsPrevPartial(snap) {
  // Partial focused month → MTD-day-range filter (matches Card 2's "Through Apr 9").
  // Complete focused month → land on the full prior month (matches "Spent in March 2026").
  const hasPartialAnchor  = snap.is_partial && snap.last_month_mtd  != null;
  const hasCompleteAnchor = !snap.is_partial && snap.last_month_total != null;
  if (!hasPartialAnchor && !hasCompleteAnchor) return;

  const lastMonth = prevMonthOf(snap.month);
  window.moneyHabitsNav = hasPartialAnchor
    ? { tab: 'transactions', year_month: lastMonth, start_day: 1, end_day: snap.through_day }
    : { tab: 'transactions', year_month: lastMonth };
  showTab('transactions');
}

function goToHabits(scope) {
  window.moneyHabitsNav = (typeof scope === 'string') ? { tab: 'habits', scope } : { tab: 'habits', ...(scope || {}) };
  showTab('habits');
}


// ── Lens state ────────────────────────────────────────────────────────────────
// Two independent dimensions:
//  - `lensTimeframe`: chart's range preset (drives the trend chart only).
//  - `lensMonth`: focused month for KPIs + drill-down (set by bar click or chip).
// Changing the chart range resets `lensMonth` to the most-recent month in range.
let lensMonth     = '';                   // YYYY-MM
let lensCategory  = '';                   // parent OR leaf name; meaning controlled by lensLevel
let lensCompare   = '';                   // YYYY-MM (dormant; UI removed)
let lensTimeframe = '';                   // preset id (one of WINDOW_PRESETS)
let lensLevel     = 'all';                // 'all' | 'parent' | 'leaf'
let lensChartView = 'total';              // 'total' | 'stacked' (only meaningful when level=all)

// Trend chart-type toggle. 'bar' (default) renders the monthly bar chart;
// 'radial' renders the year-over-year polar chart with one ring per selected
// year. In-tab session memory only — a hard reload resets to 'bar'. Hidden
// below the md: breakpoint (radial doesn't read well on phones).
let chartType    = 'bar';                 // 'bar' | 'radial'
let radialYears  = new Set();             // YYYY strings, populated on first radial activation
let radialHighlightYear = null;           // YYYY of the click-pinned year (null = no pin)

// Drill-down pie mode (only meaningful at parent scope; resets on scope change).
let ddPieMode    = 'proportion';          // 'proportion' | 'composition'
let _ddLastData  = null;                  // cached /api/category-detail payload (for cheap toggle re-render)
let _ddLastColor = null;

// Quick ranges only — the chart always renders monthly bars.
const WINDOW_PRESETS = [
  { id: 'last-3-months',   label: 'Last 3 months'  },
  { id: 'last-6-months',   label: 'Last 6 months'  },
  { id: 'last-12-months',  label: 'Last 12 months' },
  { id: 'ytd',             label: 'Year to date'   },
  { id: 'all-time',        label: 'All time'       },
];

function windowPreset(id) {
  return WINDOW_PRESETS.find(p => p.id === id) || WINDOW_PRESETS[2];
}

// Label for the Avg KPI eyebrow per preset. Phrased as a sentence rather
// than a cramped abbreviation so it matches Overview's "Spent in [Month]"
// descriptive style.
const KPI_AVG_LABEL = {
  'last-3-months':  'Avg over last 3 months',
  'last-6-months':  'Avg over last 6 months',
  'last-12-months': 'Avg over last 12 months',
  'ytd':            'Avg this year so far',
  'all-time':       'Monthly average',
};

// ── Timeframe resolvers ───────────────────────────────────────────────────────
function labelFor(t) { return windowPreset(t).label; }

// Returns the YYYY-MM the drill-down should default to for a given range:
// the latest month in the range, or the last month with data for 'all-time'.
function activeMonthFor(t) {
  const { end } = dateRangeFor(t);
  if (!end) return catAllMonths[catAllMonths.length - 1] || '';
  return end.slice(0, 7);
}

// Returns { start, end } as YYYY-MM-DD strings (or { start: null, end: null } for all-time).
function dateRangeFor(id) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-indexed
  const d = today.getDate();
  const fmt = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  switch (id) {
    case 'last-3-months': {
      const start = new Date(y, m - 2, 1);
      const end   = new Date(y, m + 1, 0);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'last-6-months': {
      const start = new Date(y, m - 5, 1);
      const end   = new Date(y, m + 1, 0);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'last-12-months': {
      const start = new Date(y, m - 11, 1);
      const end   = new Date(y, m + 1, 0);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'ytd': {
      const start = new Date(y, 0, 1);
      const end   = new Date(y, m, d);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'all-time':
    default:
      return { start: null, end: null };
  }
}

// Canonical setter for the chart range. Resets the focused month to the most
// recent month in the new range so the drill-down stays in sync.
function setLensTimeframe(t) {
  lensTimeframe   = t;
  lensMonth       = activeMonthFor(t);
  catSelectedMonth = lensMonth;
  catDetailCache  = {};
  buildS1WindowPanel();
  setHabitsPageHeader();
  renderCategoryTree();
  renderHabitsTrend();
  if (drilldownActive()) renderDrillDown();
}

// The drill-down is "active" (and worth re-rendering) when it's on screen:
// the side-by-side right pane (≥1024px) or an open flyout (narrow).
function drilldownActive() {
  if (window.innerWidth >= 1024) return true;   // right pane is `lg:block`
  return !!document.getElementById('cat-drilldown-section')?.closest('.mh-ios-flyout');
}

// Setter for the focused month — highlights the column on the chart and updates
// the drill-down in place when it's showing (the wide right pane, or open flyout).
function setLensMonth(m) {
  lensMonth = m;
  catSelectedMonth = m;
  catDetailCache = {};
  setHabitsPageHeader();
  applyMonthHighlight();
  if (drilldownActive()) renderDrillDown();
}

// Highlight the lensMonth column on the bar chart (others dim to 0.3 alpha).
// Rewrites each bar dataset's backgroundColor to a per-bar array and applies a
// no-animation update — no re-fetch / re-mount. No-op in radial mode or when no
// chart exists yet. The compare overlay line (_noHighlight) is left untouched.
function applyMonthHighlight(extraHover) {
  if (chartType !== 'bar') return;
  const chart = _charts['chart-monthly'];
  if (!chart) return;
  const periods  = chart.data.labels || [];
  const datasets = chart.data.datasets || [];
  if (!periods.length || !datasets.length) return;

  // A column "has data" only when at least one bar dataset has non-zero spend
  // at that index. Highlighting an empty column would dim every visible bar
  // (e.g. lensMonth defaults to the current month, which has no data yet), so
  // treat empty highlights as no-selection.
  const colHasData = i =>
    i >= 0 && i < periods.length &&
    datasets.some(ds => !ds._noHighlight && (Number(ds.data[i]) || 0) > 0);

  const rawMonthIdx = lensMonth ? periods.indexOf(lensMonth) : -1;
  const monthIdx    = colHasData(rawMonthIdx) ? rawMonthIdx : -1;
  const hoverIdx    = (extraHover && extraHover.pointIdx != null && colHasData(extraHover.pointIdx))
    ? extraHover.pointIdx : -1;
  const noSelection = monthIdx < 0 && hoverIdx < 0;

  datasets.forEach(ds => {
    if (ds._noHighlight) return;
    const lit = ds._base || token('color-accent-700');
    ds.backgroundColor = periods.map((_, i) =>
      (noSelection || i === monthIdx || i === hoverIdx) ? lit : hexToRgba(lit, 0.3));
  });
  chart.update('none');
}

// Flyout title — the focused month (the in-flyout header carries the scope name).
function drillFlyoutTitle() {
  return lensMonth ? `${formatMonthLabel(lensMonth)} in detail` : 'In detail';
}

// Open the month drill-down as a right flyout (M11): re-parent the persistent
// #cat-drilldown-section into the flyout, render into it, and move it back to its
// hidden home (#habits-drilldown) on dismiss. Desktop pushes the chart pane to
// 50% (compressTarget); mobile is full-screen.
function openDrillDownFlyout() {
  if (!window.MoneyHabitsIOS) return;
  const host = document.getElementById('cat-drilldown-section');
  if (!host) return;
  MoneyHabitsIOS.openRightFlyout({
    title: drillFlyoutTitle(),
    content: host,
    compressTarget: document.getElementById('habits-explorer'),
    onDismiss: () => {
      hideCjsTip();   // clear any tooltip stranded by tearing down the flyout charts
      const home = document.getElementById('habits-drilldown');
      if (home && host.parentElement !== home) home.appendChild(host);
    },
  });
  // Render after the flyout is in the DOM + sized so Chart.js lays out correctly.
  renderDrillDown();
}

// Page header (secondary nav) for the Habits tab — reads:
//   "Your Habits for [emoji] [name]"
// where the chip is an inline button. Clicking it opens #hc-chip-panel
// (the category-tree dropdown). Subtitle is intentionally blank on Habits;
// month + range live in the chart range picker / drill-down chip instead.
function setHabitsPageHeader() {
  const titleEl = document.getElementById('page-title');
  const subEl   = document.getElementById('page-subtitle');
  if (!titleEl || !subEl) return;

  const isAll = lensLevel === 'all';
  const name  = isAll ? 'All Spending' : (lensCategory || 'Habits');
  const slug  = isAll ? null            : catSlug(name);
  const emoji = isAll ? '📊'            : catEmoji(name);

  // All-spending uses the brand indigo accent; categories use their chip
  // tokens. --cat-mid drives the colored pill-bar that sits beneath the chip.
  const chipBg  = isAll ? 'var(--color-accent-50)'  : `var(--color-cat-${slug}-bg)`;
  const chipFg  = isAll ? 'var(--color-accent-700)' : `var(--color-cat-${slug}-fg)`;
  const chipBar = isAll ? 'var(--color-accent-700)' : `var(--color-cat-${slug}-mid)`;

  const emojiHtml = emoji ? `<span class="cat-emoji" aria-hidden="true">${emoji}</span>` : '';
  titleEl.innerHTML = `<span class="block text-base font-semibold text-neutral-600 mb-1">Habits</span>`
    + `Your Habits for `
    + `<span class="inline-flex flex-col align-middle ml-1" id="hc-chip-stack"`
    + ` style="--cat-mid: ${chipBar};">`
    + `<button id="hc-chip-btn" type="button"`
    + ` class="hc-chip inline-flex items-baseline gap-1 cursor-pointer hover:opacity-80 rounded-lg px-3 py-1"`
    + ` style="background-color: ${chipBg}; color: ${chipFg};">`
    + `${emojiHtml}${escHtml(name)}`
    + `</button>`
    + `<div class="hc-chip-bar" aria-hidden="true"></div>`
    + `</span>`;

  subEl.innerHTML = '&nbsp;';

  // Anchor the dropdown panel under the chip's left edge (offset within the
  // shared `relative` wrapper around the H1).
  const chipBtn = document.getElementById('hc-chip-btn');
  const panel   = document.getElementById('hc-chip-panel');
  if (chipBtn && panel) {
    panel.style.left = chipBtn.offsetLeft + 'px';
    wireDropdown(chipBtn, panel);
  }

  // Re-bind: innerHTML wiped any previous listener on the chip button.
  chipBtn?.addEventListener('click', e => {
    e.stopPropagation();
    panel?.classList.toggle('hidden');
  });
}

// Compare mode: dormant. UI removed (the right-rail Compare select is gone) but
// the underlying state stays so the feature can be reintroduced later.
function setLensCompare(m) {
  if (lensChartView === 'stacked') m = '';
  lensCompare = m;
  catCompareMonth = m;
  renderHabitsTrend();
}

function setLensScope({ level, category = '' }) {
  lensLevel    = level;
  lensCategory = category;
  catDetailCache = {};
  // Default chart view per scope:
  //   parent → 'stacked' (children breakdown is the most informative first impression)
  //   leaf   → 'total' (only valid mode — nothing to stack)
  //   all    → keep whatever the user had last
  if (level === 'parent') lensChartView = 'stacked';
  if (level === 'leaf')   lensChartView = 'total';
  // Pie mode resets to default on every scope change.
  ddPieMode = 'proportion';
  // Close the category chip dropdown if it was open.
  document.getElementById('hc-chip-panel')?.classList.add('hidden');
  // Scope change invalidates the radial year list (e.g. scoping into Food
  // hides years that have no Food data) — refresh on the next render.
  _radialDataCache = null;
  updateViewToggleUI();
  setHabitsPageHeader();
  renderCategoryTree();
  renderHabitsTrend();
  // If the drill-down flyout is open, re-render it against the new scope.
  if (drilldownActive()) renderDrillDown();
}

function setScopeAll()           { setLensScope({ level: 'all',    category: '' }); }
function setScopeParent(name)    { setLensScope({ level: 'parent', category: name }); }
function setScopeLeaf(name)      { setLensScope({ level: 'leaf',   category: name }); }

function setLensChartView(v) {
  lensChartView = v;
  updateViewToggleUI();
  renderHabitsTrend();
  if (drilldownActive()) renderDrillDown();
}

// Sync the compare-select to the current lensCompare. (Was the last surviving job
// of the now-deleted updateFilterBar — month picker and category pill are gone.)
function syncCompareSelect() {
  const compareSel = document.getElementById('cat-compare-sel');
  if (compareSel && compareSel.value !== lensCompare) compareSel.value = lensCompare;
}

function updateViewToggleUI() {
  const toggle = document.getElementById('habits-view-toggle');
  if (!toggle) return;
  // Toggle is meaningful only at scope=all / scope=parent in bar mode. At
  // leaf scope or in radial mode there's nothing to stack — hide the control
  // entirely so the chart-card surface only shows what's actionable.
  // (Radial-mode hide is also handled by syncChartTypeUI, but we mirror it
  // here so future scope changes don't accidentally reveal it.)
  const usable = chartType === 'bar' && (lensLevel === 'all' || lensLevel === 'parent');
  toggle.classList.toggle('hidden', !usable);
  toggle.querySelectorAll('.habits-view-btn').forEach(btn => {
    const active = btn.dataset.view === lensChartView;
    btn.classList.toggle('bg-neutral-100', active);
    btn.classList.toggle('text-neutral-900', active);
    btn.classList.toggle('font-semibold', active);
    btn.classList.toggle('text-neutral-500',  !active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function updateCompareDisabled() {
  const compareSel = document.getElementById('cat-compare-sel');
  if (!compareSel) return;
  const disabled = lensChartView === 'stacked';
  compareSel.disabled = disabled;
  compareSel.title = disabled ? 'Switch to Total view to compare' : '';
}

// ── Habits chart + tree + KPIs ────────────────────────────────────────────────
// Muted slate for the compare-line overlay — gray-400 reads as "secondary" but
// not so faint that it disappears against the chart's main bars.
const S1_COMPARE_COLOR = () => token('color-gray-400');

// Convert "#rrggbb" → {h, s, l} ∈ [0,1]. Used by derivedShade().
function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToHex({ h, s, l }) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = v => Math.round(Math.max(0, Math.min(255, v * 255))).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Lightness ramp off a base hex. idx=0 (highest spend) is darkest;
// later indices step lighter. Caller sorts items by total desc before assigning idx.
function derivedShade(parentHex, idx, count) {
  const { h, s, l } = hexToHsl(parentHex);
  if (count <= 1) return parentHex;
  // Ramp lightness across ±30% of base, biased so idx=0 is darker than base.
  // The wider span gives better perceptual distinctness across few rings
  // (e.g. radial 3-year mode) while the clamps keep extremes legible.
  const span = 0.30;
  const minL = Math.max(0.15, l - span);
  const maxL = Math.min(0.85, l + span);
  const t = idx / (count - 1);                 // 0 → 1
  const lOut = minL + (maxL - minL) * t;
  return hslToHex({ h, s, l: lOut });
}

async function initDashboard() {
  const [allMonths, _meta] = await Promise.all([
    fetchJsonCached('months.json'),
    loadCategoryMeta(),
  ]);

  catAllMonths = allMonths.slice().sort();

  // (Compare select removed from UI; setLensCompare scaffolding stays dormant.)

  // View toggle (Total ↔ Stacked).
  document.querySelectorAll('.habits-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (lensLevel === 'leaf') return;   // toggle inert at leaf scope
      setLensChartView(btn.dataset.view);
    });
  });

  // Bar ↔ Radial chart-type toggle (desktop only — wrapper is hidden via
  // Tailwind below md:, so listeners on its children are inert on mobile).
  document.querySelectorAll('.habits-charttype-btn').forEach(btn => {
    btn.addEventListener('click', () => setChartType(btn.dataset.charttype));
  });

  // Auto-flip back to bar when the viewport drops below md (768px). The
  // toggle wrapper is hidden via CSS at that width, but a user might have
  // chosen radial on desktop and then resized — re-render so they're not
  // stranded with an inert chart-type they can't change.
  const mq = window.matchMedia('(min-width: 768px)');
  const onMqChange = e => {
    if (!e.matches && chartType === 'radial') setChartType('bar');
    // Swap the drill-down bubble (desktop) ↔ daily strip (mobile) on breakpoint
    // cross. renderDdBubble dispatches to the right one based on viewport width.
    if (_ddLastData) renderDdBubble(_ddLastData, null, _ddLastColor);
  };
  if (mq.addEventListener) mq.addEventListener('change', onMqChange);
  else                     mq.addListener(onMqChange);  // older Safari

  // Reconcile the shared drill-down across the side-by-side ↔ flyout breakpoint
  // (1024px). Crossing either way: close an open flyout (moves the content back
  // to its home), then render into the now-visible right pane when going wide.
  const mqWide = window.matchMedia('(min-width: 1024px)');
  const onWideChange = () => {
    if (window.MoneyHabitsIOS) MoneyHabitsIOS.closeRightFlyout?.();
    hideCjsTip();
    if (window.innerWidth >= 1024) renderDrillDown();
  };
  if (mqWide.addEventListener) mqWide.addEventListener('change', onWideChange);
  else                        mqWide.addListener(onWideChange);

  // Year multi-select picker (radial mode only). Panel contents are built
  // lazily by renderHabitsRadial once we have the data.
  const yearBtn   = document.getElementById('radial-year-btn');
  const yearPanel = document.getElementById('radial-year-panel');
  if (yearBtn && yearPanel) {
    wireDropdown(yearBtn, yearPanel);
    yearBtn.addEventListener('click', e => { e.stopPropagation(); yearPanel.classList.toggle('hidden'); });
    document.addEventListener('click', e => {
      if (!yearBtn.contains(e.target) && !yearPanel.contains(e.target)) {
        yearPanel.classList.add('hidden');
      }
    });
  }

  // Chart range picker (quick ranges only, lives in chart card header).
  const winBtn   = document.getElementById('s1-window-btn');
  const winPanel = document.getElementById('s1-window-panel');
  if (winBtn && winPanel) {
    wireDropdown(winBtn, winPanel);
    winBtn.addEventListener('click', e => { e.stopPropagation(); winPanel.classList.toggle('hidden'); });
    document.addEventListener('click', e => {
      if (!winBtn.contains(e.target) && !winPanel.contains(e.target)) {
        winPanel.classList.add('hidden');
      }
    });
  }

  // Inject drill-down skeleton (lives off-screen in #habits-drilldown until a
  // bar click re-parents it into the flyout).
  buildCategoriesTabUI();

  // Page-header category chip dropdown — outside-click closes the panel.
  // The chip button is rebuilt on every scope change (innerHTML wipe inside
  // setHabitsPageHeader), but the panel itself is stable in base.html, so this
  // listener targets both by id and survives chip rebuilds.
  document.addEventListener('click', e => {
    const panel = document.getElementById('hc-chip-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    const btn = document.getElementById('hc-chip-btn');
    if (!btn?.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });

  // Drill-down pie mode toggle (Proportion ↔ Composition; visible at parent scope only).
  document.querySelectorAll('.dd-pie-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      ddPieMode = btn.dataset.pieMode;
      if (_ddLastData) renderDdPie(_ddLastData, _ddLastColor);
    });
  });

  // Default state: 12-month range, focused month = most recent in range.
  lensTimeframe   = 'last-12-months';
  lensMonth       = activeMonthFor(lensTimeframe);
  catSelectedMonth = lensMonth;
  lensLevel       = 'all';
  lensCategory    = '';
  lensChartView   = 'total';

  buildS1WindowPanel();
  updateViewToggleUI();
  syncChartTypeUI();
  setHabitsPageHeader();

  await Promise.all([
    renderCategoryTree(),
    renderHabitsTrend(),
  ]);
  // Side-by-side: render the right pane for the default month on load. On narrow
  // viewports the drill-down stays closed until a bar click opens the flyout.
  if (window.innerWidth >= 1024) renderDrillDown();
}

function buildS1WindowPanel() {
  const panel = document.getElementById('s1-window-panel');
  if (!panel) return;
  panel.innerHTML = '';

  WINDOW_PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.timeframe = p.id;
    const isActive = p.id === lensTimeframe;
    b.className = ['block w-full text-left text-sm px-3 py-1.5 hover:bg-neutral-50',
                   isActive ? 'bg-neutral-100 text-neutral-900 font-semibold' : ''].join(' ');
    b.textContent = p.label;
    b.addEventListener('click', () => {
      panel.classList.add('hidden');
      setLensTimeframe(p.id);
    });
    panel.appendChild(b);
  });

  const winLabel = document.getElementById('s1-window-label');
  if (winLabel) winLabel.textContent = labelFor(lensTimeframe);
}

// ── Hierarchical category tree (left rail) ────────────────────────────────────
async function renderCategoryTree() {
  const list = document.getElementById('hc-cat-panel-list');
  if (!list) return;
  // The tree is a navigation device — its totals reflect the full active
  // timeframe. The build emits one hierarchy file per timeframe preset.
  const data = await fetchJsonCached(`category-hierarchy-${lensTimeframe}.json`);

  list.innerHTML = '';

  // "All Spending" row pinned at top.
  list.appendChild(buildTreeRow({
    name: 'All Spending',
    level: 'all',
    total: data.all_total,
    indent: 0,
    isActive: lensLevel === 'all',
    onClick: () => setScopeAll(),
  }));

  data.nodes.forEach(node => {
    const isActiveParent = lensLevel === 'parent' && lensCategory === node.name;
    list.appendChild(buildTreeRow({
      name:  node.name,
      level: node.level,
      total: node.total,
      indent: 0,
      hasChildren: !!node.children?.length,
      isActive: (node.level === 'parent' && isActiveParent) ||
                (node.level === 'leaf'   && lensLevel === 'leaf' && lensCategory === node.name),
      onClick: () => {
        if (node.level === 'parent') setScopeParent(node.name);
        else                          setScopeLeaf(node.name);
      },
    }));

    // Children always expanded by default per design.
    (node.children || []).forEach(child => {
      list.appendChild(buildTreeRow({
        name:  child.name,
        level: 'leaf',
        total: child.total,
        indent: 1,
        isActive: lensLevel === 'leaf' && lensCategory === child.name,
        onClick: () => setScopeLeaf(child.name),
      }));
    });
  });
}

function buildTreeRow({ name, level, total, indent, isActive, onClick, hasChildren }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.level = level;
  btn.dataset.name  = name;
  btn.className = [
    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors',
    isActive ? 'bg-neutral-100 text-neutral-900 ring-1 ring-neutral-200 font-semibold' : 'hover:bg-neutral-50 text-neutral-700',
  ].join(' ');
  btn.style.paddingLeft = (12 + indent * 16) + 'px';

  if (level === 'all') {
    btn.innerHTML = `
      <span class="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full max-w-full truncate"
            style="background-color: var(--color-accent-50); color: var(--color-accent-700);">
        <span class="cat-emoji" aria-hidden="true">📊</span>All Spending
      </span>
      <span class="text-xs tabular-nums text-neutral-500 ml-auto">${fmt(total)}</span>
    `;
  } else {
    btn.innerHTML = `
      <span class="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full max-w-full truncate" style="${catChipStyle(name)}">${catLabelHtml(name)}</span>
      <span class="text-xs tabular-nums text-neutral-500 ml-auto">${fmt(total)}</span>
    `;
  }
  btn.addEventListener('click', onClick);
  return btn;
}

// ── Trend chart dispatcher ────────────────────────────────────────────────────
// Picks bar vs radial based on chartType. Every setter that needs to rerender
// the trend chart calls this — keeping the per-mode renderers free to assume
// they own the chart card slot.
function renderHabitsTrend() {
  if (chartType === 'radial') return renderHabitsRadial();
  return renderHabitsChart();
}

// Setter for chart type (bar ↔ radial). Re-renders the chart and re-syncs the
// header controls (timeframe pill, year picker, Total/Stacked toggle, icon
// toggle). On first activation of radial, defaults `radialYears` to the most
// recent year present in the dataset (single ring) per PRD §4.
function setChartType(t) {
  if (t !== 'bar' && t !== 'radial') return;
  if (t === chartType) return;
  chartType = t;
  hideCustomTooltip();
  syncChartTypeUI();
  renderHabitsTrend();
}

// Toggles a year on/off in the radial selection. No-op when called in bar
// mode. When the toggle would empty the selection we still allow it — the
// chart renders an empty-state message.
function toggleRadialYear(year) {
  if (radialYears.has(year)) {
    radialYears.delete(year);
  } else {
    if (radialYears.size >= 3) return;   // hard cap: max 3 rings at a time
    radialYears.add(year);
  }
  if (chartType === 'radial') renderHabitsRadial();   // also re-runs buildRadialYearPanel
}

// Sync the chart-card header to the active chartType:
//  - radial: hide timeframe pill + Total/Stacked toggle, show year picker
//  - bar   : reverse
// Also re-syncs the icon toggle's pressed state.
function syncChartTypeUI() {
  const winDD     = document.getElementById('s1-window-dropdown');
  const yearDD    = document.getElementById('radial-year-dropdown');
  const isRadial  = chartType === 'radial';

  winDD?.classList.toggle('hidden',   isRadial);
  yearDD?.classList.toggle('hidden', !isRadial);
  // Total/Stacked toggle visibility is owned by updateViewToggleUI (it also
  // accounts for leaf scope where stacking is meaningless).
  updateViewToggleUI();

  document.querySelectorAll('.habits-charttype-btn').forEach(btn => {
    const active = btn.dataset.charttype === chartType;
    btn.classList.toggle('bg-neutral-100', active);
    btn.classList.toggle('text-neutral-900', active);
    btn.classList.toggle('text-neutral-500', !active);
    btn.classList.toggle('hover:bg-neutral-50', !active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  // Toggle the chart container visibility — each renderer needs its slot to
  // have dimensions when it draws, so flip the visible slot before rendering.
  // (Chart.js bar in #chart-monthly, SVG radial in #chart-radial.)
  document.getElementById('chart-monthly')?.classList.toggle('hidden',  isRadial);
  document.getElementById('chart-radial') ?.classList.toggle('hidden', !isRadial);
}

// ── Unified bar chart ─────────────────────────────────────────────────────────
async function renderHabitsChart() {
  hideCustomTooltip();
  const granularity = 'month';   // chart is always monthly bars
  const { start, end } = dateRangeFor(lensTimeframe);

  // Update header text.
  const titleEl = document.getElementById('habits-chart-title');
  if (titleEl) {
    const scopeLabel = lensLevel === 'all' ? 'All Spending' : lensCategory;
    titleEl.textContent = `${scopeLabel} Over ${labelFor(lensTimeframe)}`;
  }
  const winLabel = document.getElementById('s1-window-label');
  if (winLabel) winLabel.textContent = labelFor(lensTimeframe);

  const buildQuery = (s, e, opts = {}) => {
    const params = new URLSearchParams();
    params.set('granularity', granularity);
    if (s) params.set('start', s);
    if (e) params.set('end', e);
    if (opts.parent)     params.set('parent', opts.parent);
    if (opts.group_by)   params.set('group_by', opts.group_by);
    if (opts.categories) params.set('categories', opts.categories);
    return '?' + params.toString();
  };

  // Decide query shape per (level, view).
  let queryOpts = {};
  let mode = 'single';   // 'single' | 'stacked'
  if (lensLevel === 'all') {
    if (lensChartView === 'stacked') {
      queryOpts = { group_by: 'parent' };
      mode = 'stacked';
    }
  } else if (lensLevel === 'parent') {
    if (lensChartView === 'stacked') {
      queryOpts = { parent: lensCategory, group_by: 'parent' };
      mode = 'stacked';
    } else {
      // Total: aggregate the parent into a single trace using the parent's own color.
      queryOpts = { parent: lensCategory };
      // mode stays 'single'
    }
  } else { // leaf
    queryOpts = { categories: lensCategory };
  }

  const _primaryFile = await fetchJsonCached(habitsMonthlyFile(lensLevel, lensCategory, lensChartView));
  const primary = filterPeriodsByRange(_primaryFile.periods || [], start, end);
  const periods = primary.map(d => d.period);

  const datasets = [];

  if (mode === 'stacked') {
    // Aggregate every key seen across periods so stack ordering is stable.
    const keyTotals = {};
    primary.forEach(row => {
      Object.entries(row.totals || {}).forEach(([k, v]) => {
        keyTotals[k] = (keyTotals[k] || 0) + v;
      });
    });
    const keys = Object.keys(keyTotals).sort((a, b) => keyTotals[b] - keyTotals[a]);

    keys.forEach((key, idx) => {
      // Color: parent-stack uses each parent's own slug; child-stack uses derivedShade off parent hex.
      const color = lensLevel === 'parent'
        ? derivedShade(catHex(lensCategory, 'mid'), idx, keys.length)
        : (key === 'Other' ? token('color-cat-default-mid') : catHex(key, 'mid'));

      datasets.push({
        label: key,
        data: primary.map(row => row.totals?.[key] || 0),
        backgroundColor: color,
        _base: color,                       // applyMonthHighlight reads this
        borderColor: token('color-white'),
        borderWidth: 0.5,
        stack: 'spend',
        categoryPercentage: 0.7,
        barPercentage: 0.98,
      });
    });
  } else {
    // Single bar (total, leaf, or all-with-no-stack).
    // 'all' scope is the canonical view → brand indigo (accent-700). Leaf/parent use their own hue.
    const traceColor = lensLevel === 'all' ? token('color-accent-700') : catHex(lensCategory, 'mid');
    datasets.push({
      label: lensLevel === 'all' ? 'All Spending' : lensCategory,
      data: primary.map(d => d.total),
      backgroundColor: traceColor,
      _base: traceColor,
      categoryPercentage: 0.7,
      barPercentage: 0.9,
    });
  }

  // Compare overlay (skipped in stacked mode by setLensCompare invariant) — a
  // dashed line on top of the bars. Chart is always monthly, so we shift the
  // window by `periods.length` months ending at lensCompare.
  if (lensCompare && mode === 'single') {
    const fmtD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const [cy, cm] = lensCompare.split('-').map(Number);
    const cmpEnd   = fmtD(new Date(cy, cm, 0));
    const cmpStart = fmtD(new Date(cy, cm - periods.length, 1));
    const _cmpFile = await fetchJsonCached(habitsMonthlyFile(lensLevel, lensCategory, lensChartView));
    const compare = filterPeriodsByRange(_cmpFile.periods || [], cmpStart, cmpEnd);
    const compareTotals = compare.map(d => d.total || 0);
    while (compareTotals.length < periods.length) compareTotals.push(0);
    datasets.push({
      type: 'line',
      label: `vs ${formatMonthLabel(lensCompare)}`,
      data: compareTotals.slice(0, periods.length),
      borderColor: S1_COMPARE_COLOR(),
      borderWidth: 2,
      borderDash: [6, 3],
      pointRadius: 3,
      pointBackgroundColor: S1_COMPARE_COLOR(),
      tension: 0,
      _noHighlight: true,        // applyMonthHighlight skips the overlay line
    });
  }

  // Pre-compute tick labels (e.g. "May", "May '24").
  const ticktext = periods.map((p, i) => formatPeriodTick(p, granularity, i, periods.length));

  // Height per viewport (PRD §8.4): 360 mobile / 480 desktop.
  const monthEl = document.getElementById('chart-monthly');
  if (monthEl) monthEl.style.height = (window.innerWidth < 768 ? 360 : 480) + 'px';

  const isMobile = window.innerWidth < 768;
  const base = chartLayout();
  const chart = mountChart('chart-monthly', {
    type: 'bar',
    data: { labels: periods, datasets },
    options: {
      ...base,
      // Mobile taps drill (no tooltip); desktop hover identifies via the tooltip.
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: { ...base.scales.x, stacked: mode === 'stacked',
             ticks: { ...base.scales.x.ticks, callback: (v, i) => ticktext[i] } },
        y: { ...base.scales.y, stacked: mode === 'stacked', beginAtZero: true },
      },
      // Click-to-drill: stacked segment → scope drill; otherwise focus the month.
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const { datasetIndex, index } = elements[0];
        if (mode === 'stacked') {
          const name = datasets[datasetIndex]?.label;
          if (name && name !== 'Other') {
            if (lensLevel === 'all')    { setScopeParent(name); return; }
            if (lensLevel === 'parent') { setScopeLeaf(name);   return; }
          }
        }
        const monthKey = periods[index];
        if (monthKey) {
          setLensMonth(monthKey);                                    // updates the wide right pane in place
          if (window.innerWidth < 1024) openDrillDownFlyout();       // narrow: open the flyout
        }
      },
      onHover: (evt, elements, ch) => {
        const idx = elements.length ? elements[0].index : -1;
        ch.canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
        if (ch.$lastHover === idx) return;       // only re-highlight on change
        ch.$lastHover = idx;
        applyMonthHighlight(idx >= 0 ? { pointIdx: idx } : undefined);
      },
      plugins: {
        // Legend: re-enabled for stacked modes only (color key + tap-to-drill
        // target on mobile). Off for single/leaf/total. legend.onClick drills
        // into the clicked series instead of toggling visibility.
        legend: {
          display: mode === 'stacked',
          position: 'top', align: 'end',
          labels: { usePointStyle: true, boxWidth: 10, font: { size: 12 } },
          onClick: (e, item) => {
            const name = datasets[item.datasetIndex]?.label;
            if (!name || name === 'Other') return;
            if (lensLevel === 'all')    setScopeParent(name);
            else if (lensLevel === 'parent') setScopeLeaf(name);
          },
        },
        tooltip: isMobile
          ? { enabled: false }
          : { enabled: false, external: makeTipExternal((ctx) => cjsTipBar(ctx, mode, primary)) },
      },
    },
  });
  if (chart) chart.$lastHover = -1;

  const scopeLabel = lensLevel === 'all' ? 'All spending' : (lensCategory || 'spending');
  setChartA11y('chart-monthly', `${scopeLabel} trend chart, ${mode === 'stacked' ? 'stacked by parent group' : 'total by ' + granularity}, ${periods.length} ${granularity}${periods.length !== 1 ? 's' : ''}`);

  // Initial paint: apply the current lensMonth highlight (no-op if unset).
  applyMonthHighlight();
}

// Bar-chart tooltip spec. mode = 'single' | 'stacked'; primary is the
// /api/monthly response (for % of period total in stacked mode). Desktop only —
// on mobile the bar has no tooltip (tap drills).
function cjsTipBar(ctx, mode, primary) {
  const dp = ctx.tooltip.dataPoints?.[0];
  if (!dp) return null;
  const period = dp.label;                       // YYYY-MM
  const monthLabel = period ? formatMonthLabel(period) : '';
  const value = fmt(dp.parsed.y || 0);

  // Compare overlay (the dashed line dataset).
  if (dp.dataset._noHighlight) {
    return { title: `vs ${formatMonthLabel(lensCompare)}`, meta: monthLabel, value };
  }

  // Stacked bar — segment emoji + name + % of period total in one subtitle.
  if (mode === 'stacked') {
    const segName = dp.dataset.label || '';
    const row = primary.find(r => r.period === period);
    const periodTotal = row ? Object.values(row.totals || {}).reduce((a, b) => a + (b || 0), 0) : 0;
    const pct = periodTotal > 0 ? Math.round((dp.parsed.y / periodTotal) * 100) : 0;
    const isOther = segName === 'Other';
    return {
      accentSlug: isOther ? 'default' : (segName ? catSlug(segName) : ''),
      title: segName ? (isOther ? escHtml(segName) : tipCatBadge(segName)) : '',
      meta: (periodTotal > 0 && monthLabel) ? `${pct}% of ${monthLabel} Spend` : monthLabel,
      value,
    };
  }

  // Single bar — accent matches the active scope's hue.
  return {
    accentSlug: lensLevel === 'all' ? '' : catSlug(lensCategory),
    title: lensLevel === 'all' ? 'All Spending' : tipCatBadge(lensCategory),
    meta: monthLabel,
    value,
  };
}


// ── Radial (year-over-year) chart ─────────────────────────────────────────────
// Same scope contract as the bar chart: lensLevel + lensCategory drive the
// /api/radial filter (parent → ?parent=, leaf → ?category=, all → unfiltered).
// Independent year multi-select via radialYears (Set<string>) — replaces the
// timeframe pill in radial mode. Click a node → setLensMonth + scroll to
// drill-down (same contract as bar clicks; chart does NOT re-render).
//
// Cache keyed by scope so flipping years (the user's most common interaction)
// doesn't refetch the same payload.
let _radialDataCache = null;
let _radialDataKey   = '';

function radialScopeKey() {
  return `${lensLevel}::${lensCategory || ''}`;
}

async function fetchRadialDataScoped() {
  const key = radialScopeKey();
  if (_radialDataCache && _radialDataKey === key) return _radialDataCache;
  const file = await fetchJsonCached(`radial-${scopeSlug(lensLevel, lensCategory)}.json`);
  _radialDataCache = file.years || {};
  _radialDataKey   = key;
  return _radialDataCache;
}

// Per-year color derived from the active scope's category (or accent indigo
// at all-scope), then shaded by year recency via derivedShade — so the radial
// rings inherit the scope's identity color the same way the bar chart does,
// rather than carrying a separate year palette.
function radialColorFor(year, visibleYears) {
  const idx = visibleYears.indexOf(year);
  if (idx < 0) return token('color-cat-default-mid');
  const baseHex = lensLevel === 'all'
    ? token('color-accent-700')
    : catHex(lensCategory, 'mid');
  return derivedShade(baseHex, idx, Math.max(visibleYears.length, 1));
}

function buildRadialYearPanel(allYears) {
  const panel = document.getElementById('radial-year-panel');
  if (!panel) return;
  panel.innerHTML = '';
  // Most recent year at top of the list — matches how the user thinks about years.
  const sortedDesc = allYears.slice().sort().reverse();
  // Hard cap of 3 selections. Disable the unselected rows once cap is hit so
  // the user understands they need to uncheck one to swap (a silent no-op
  // would be confusing).
  const atCap = radialYears.size >= 3;
  sortedDesc.forEach(year => {
    const isChecked = radialYears.has(year);
    const isDisabled = atCap && !isChecked;
    const label = document.createElement('label');
    label.className = isDisabled
      ? 'flex items-center gap-2.5 px-3 py-1.5 text-sm text-neutral-700 opacity-50 cursor-not-allowed pointer-events-none'
      : 'flex items-center gap-2.5 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 cursor-pointer';
    if (isDisabled) label.title = 'Limit of 3 years — uncheck one to swap.';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = year;
    cb.checked = isChecked;
    cb.disabled = isDisabled;
    cb.className = 'accent-accent-700 w-3.5 h-3.5';
    cb.addEventListener('change', () => toggleRadialYear(year));
    label.appendChild(cb);
    label.appendChild(document.createTextNode(year));
    panel.appendChild(label);
  });
  syncRadialYearLabel(allYears);
}

function syncRadialYearLabel(allYears) {
  const labelEl = document.getElementById('radial-year-label');
  if (!labelEl) return;
  const sel = [...radialYears];
  if (sel.length === 0)                     labelEl.textContent = 'No years';
  else if (sel.length === allYears.length)  labelEl.textContent = 'All years';
  else if (sel.length === 1)                labelEl.textContent = sel[0];
  else                                       labelEl.textContent = `${sel.length} years`;
}

async function renderHabitsRadial() {
  hideCustomTooltip();

  // Update the chart card title to mirror the bar chart's pattern.
  const titleEl = document.getElementById('habits-chart-title');
  if (titleEl) {
    const scopeLabel = lensLevel === 'all' ? 'All Spending' : lensCategory;
    titleEl.textContent = `${scopeLabel} — Year-over-Year`;
  }

  // Make sure the radial slot is the visible one — the SVG sizes to its
  // container, so it needs definite dimensions before render.
  document.getElementById('chart-monthly')?.classList.add('hidden');
  document.getElementById('chart-radial') ?.classList.remove('hidden');

  const data     = await fetchRadialDataScoped();
  const allYears = Object.keys(data).sort();   // ascending

  // First-activation default: most recent year only (single ring per PRD §4).
  // Also prune any selected years that are no longer present (e.g. after a
  // scope change to a category that didn't exist in some years).
  if (radialYears.size === 0 && allYears.length) {
    radialYears.add(allYears[allYears.length - 1]);
  } else {
    [...radialYears].forEach(y => { if (!allYears.includes(y)) radialYears.delete(y); });
  }

  buildRadialYearPanel(allYears);

  // Visible = selected ∩ has-data — empty rings (year picked but zero spend
  // for the active scope) are dropped silently per PRD §5.
  const visibleYears = allYears
    .filter(y => radialYears.has(y))
    .filter(y => (data[y] || []).some(v => v > 0))
    .sort((a, b) => Number(b) - Number(a));   // most recent first → palette index 0

  // Empty-state: render an overlay message when there's nothing to draw.
  const radialEl = document.getElementById('chart-radial');
  if (!radialEl) return;
  if (!visibleYears.length) {
    MoneyHabitsRadial.destroy(radialEl);
    const scopeLabel = lensLevel === 'all' ? 'all spending' : (lensCategory || 'this scope');
    radialEl.innerHTML = `
      <div class="h-full w-full flex items-center justify-center text-sm text-neutral-500">
        No data for ${escHtml(scopeLabel)} in selected years.
      </div>`;
    setChartA11y('chart-radial', `No radial data for ${scopeLabel} in selected years`);
    return;
  }

  // Drop the click-pin if the highlighted year is no longer visible (e.g.
  // user unchecked it from the year picker).
  if (radialHighlightYear && !visibleYears.includes(radialHighlightYear)) {
    radialHighlightYear = null;
  }

  const scopeLabel = lensLevel === 'all' ? 'All spending' : (lensCategory || 'spending');

  // Hand off to the SVG module. app.js still owns state (pin, focused month)
  // and the tooltip — radial.js just renders + emits hover/click.
  MoneyHabitsRadial.render(radialEl, {
    data,
    years: visibleYears,                       // most-recent first → palette index 0
    colorForYear: (year) => radialColorFor(year, visibleYears),
    ariaLabel: `Year-over-year monthly spending for ${scopeLabel}, ${visibleYears.length} year${visibleYears.length !== 1 ? 's' : ''} shown`,
    // Hover → custom tooltip + spotlight the hovered year (dim the rest).
    onMonthHover: ({ year, monthName, value, event }) => {
      showCustomTooltip(tipRadialHTML(year, monthName, value), event);
      applyRadialHighlight(year);
    },
    onMonthLeave: () => { hideCustomTooltip(); applyRadialHighlight(); },
    // Click a node → focus month (updates the wide pane) + toggle the pin;
    // open the flyout only on narrow viewports.
    onMonthClick: ({ year, month }) => {
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      radialHighlightYear = (radialHighlightYear === year) ? null : year;
      applyRadialHighlight();
      setLensMonth(monthKey);
      if (window.innerWidth < 1024) openDrillDownFlyout();
    },
    // Legend swatch → pin toggle (no month chosen, so no drill-down nav).
    onYearClick: (year) => {
      radialHighlightYear = (radialHighlightYear === year) ? null : year;
      applyRadialHighlight();
    },
  });

  setChartA11y('chart-radial',
    `Year-over-year monthly spending for ${scopeLabel}, ${visibleYears.length} year${visibleYears.length !== 1 ? 's' : ''} shown`);

  // Initial paint: respect any pre-existing pin.
  applyRadialHighlight();
}

// Dim non-highlighted year rings. `hoverYear` overrides the pinned state for
// the duration of a hover; without it, falls back to radialHighlightYear. When
// neither is set, all rings render at full opacity. Delegates to radial.js.
function applyRadialHighlight(hoverYear) {
  const radialEl = document.getElementById('chart-radial');
  if (!radialEl) return;
  MoneyHabitsRadial.setHighlight(radialEl, hoverYear || radialHighlightYear || null);
}


function formatMonthLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || '';
  const [y, m] = ym.split('-');
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Tick label for an x-axis period. The bar chart's x-axis is categorical, so
// we compute explicit display labels via this helper and emit them from the
// scale's ticks.callback.
//
// Rules (driven by granularity + period count):
//   month, ≤12 ticks  → "MMM"; first tick + Jan ticks show "MMM 'YY"
//   month, 13–24 ticks → "MMM 'YY" everywhere
//   month, >24 ticks  → quarterly: "Q# 'YY" on Jan/Apr/Jul/Oct, blank otherwise
//   week              → "MMM d" of week-start
//   day               → "MMM d"; new-month-first-day shows "MMM d", others "d"
function formatPeriodTick(period, granularity, idx, totalCount) {
  if (granularity === 'month') {
    if (!/^\d{4}-\d{2}$/.test(period)) return period;
    const [y, m] = period.split('-').map(Number);
    const yr2 = String(y).slice(-2);
    if (totalCount > 24) {
      // Quarterly markers; blank otherwise
      if ([1, 4, 7, 10].includes(m)) return `Q${Math.ceil(m / 3)} '${yr2}`;
      return '';
    }
    if (totalCount > 12) {
      return `${SHORT_MONTHS[m - 1]} '${yr2}`;
    }
    // ≤ 12 months: just "MMM", but the first tick + every January carries the year
    if (idx === 0 || m === 1) return `${SHORT_MONTHS[m - 1]} '${yr2}`;
    return SHORT_MONTHS[m - 1];
  }

  if (granularity === 'week' || granularity === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return period;
    const [y, m, d] = period.split('-').map(Number);
    if (granularity === 'day') {
      // Show "MMM d" for first tick + first-of-month; "d" otherwise
      if (idx === 0 || d === 1) return `${SHORT_MONTHS[m - 1]} ${d}`;
      return String(d);
    }
    return `${SHORT_MONTHS[m - 1]} ${d}`;
  }

  return period;
}

// Parse YYYY-MM-DD as a local date — `new Date("YYYY-MM-DD")` is UTC and
// shifts back one day in negative-offset locales.
function formatTxnDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

// "Monday - May 5"-style date for tooltip subtitles. Weekday + month name +
// day, no year — concise and readable in a small surface.
function formatBubbleDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = dt.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${weekday} - ${monthDay}`;
}

// ── Categories (Category Spending) ────────────────────────────────────────────

// Category → CSS-variable slug. Hex values live in static/css/style.css :root
// as --color-cat-{slug}-{bg|fg|mid}. Children inherit their parent's slug
// via /api/category-meta + catSlug() below.
const PARENT_SLUG = {
  'Food & Drink':    'food',       // orange
  'Personal Care':   'personal',   // pink
  'Car & Transport': 'car',        // blue (legacy Copilot naming)
  'Transportation':  'car',        // blue
  'Shopping':        'shopping',   // emerald
  'Housing':         'apartment',  // amber
  'Utilities':       'utilities',  // cyan
  'Health':          'health',     // red
  'Entertainment':   'fun',        // purple
  'Debt':            'loans',      // green
  'Other':           'other',      // gray
};
const ORPHAN_SLUG = {
  'Rent':                       'rent',
  'Apartment':                  'apartment',
  'Utilities':                  'utilities',
  'Subscriptions':              'subs',
  'Healthcare':                 'health',
  'Gym':                        'gym',
  'Yoga':                       'yoga',
  'Tattoo':                     'tattoo',
  'Education':                  'edu',
  'Entertainment/Recreation':   'fun',
  'Gifts':                      'gifts',
  'Travel & Vacation':          'travel',
  'Laundry':                    'laundry',
  'Work Expenses':              'work',
  'Moving Expenses':            'moving',
  'ATM Fee':                    'atm',
  'CC Interest':                'cci',
  'Student Loans':              'loans',
  'Other':                      'other',
};

// category_norm → emoji. Stored as Unicode literals so the browser uses its
// OS color-emoji font; see .cat-emoji class in style.css.
const CATEGORY_EMOJI = {
  // Food & Drink
  'Restaurants': '🍽️', 'Cafés': '☕', 'Fast Food / Convenience Food': '🍔',
  'Groceries': '🛒', 'Bars': '🍸', 'Brunch': '🥞', 'Food Delivery': '🥡',
  // Personal Care
  'Hair': '💇', 'Laser': '✨', 'Lotions & Potions': '🧴', 'Nails': '💅',
  'Personal Care': '🧖',
  // Car & Transport
  'Train': '🚆', 'Uber': '🚗', 'Rideshare': '🚕', 'Transit': '🚇',
  // Shopping
  'Clothing': '👕', 'Shops': '🛍️', 'General Shopping': '🛒',
  // Orphans
  'Rent': '🏠', 'Apartment': '🏢', 'Utilities': '💡', 'Subscriptions': '📺',
  'Healthcare': '🏥', 'Gym': '🏋️', 'Gym Membership': '💪', 'Yoga': '🧘',
  'Tattoo': '🎨', 'Fitness Classes': '🤸', 'Education': '🎓',
  'Entertainment/Recreation': '🎟️', 'Entertainment': '🎬', 'Gifts': '🎁',
  'Travel & Vacation': '✈️', 'Flights': '🛫', 'Laundry': '🧺',
  'Work Expenses': '💼', 'Moving Expenses': '📦', 'ATM Fee': '🏧',
  'CC Interest': '💳', 'Credit Card Payment': '🧾', 'Student Loans': '🎒',
  'Income': '💰', 'Interest Income': '📈', 'Savings Transfer': '🐷',
  'London Expenses': '🇬🇧', 'Venmo Social': '💸', 'Other': '❓',
};

function catEmoji(catNorm) {
  return CATEGORY_EMOJI[catNorm] || '';
}

// HTML fragment: `<span class="cat-emoji">🍔</span>Restaurants` — used wherever
// a category name renders so the emoji always sits next to it.
function catLabelHtml(catNorm) {
  const e = catEmoji(catNorm);
  return e ? `<span class="cat-emoji" aria-hidden="true">${e}</span>${escHtml(catNorm)}` : escHtml(catNorm);
}

let _catMeta = null;
let _catMetaPromise = null;
function loadCategoryMeta() {
  if (!_catMetaPromise) {
    _catMetaPromise = fetchJsonCached('category-meta.json')
      .then(rows => { _catMeta = rows; return rows; });
  }
  return _catMetaPromise;
}

function catSlug(catNorm) {
  if (!catNorm || catNorm === 'Uncategorized') return 'default';
  if (PARENT_SLUG[catNorm]) return PARENT_SLUG[catNorm];
  // Prefer the parent-group color over ORPHAN_SLUG so leaves visually cluster
  // under their parent. ORPHAN_SLUG is the fallback for true orphans (leaves
  // with no parent in the CSV).
  const parent = _catMeta?.find(r => r.category === catNorm)?.parent;
  if (parent && PARENT_SLUG[parent]) return PARENT_SLUG[parent];
  if (ORPHAN_SLUG[catNorm]) return ORPHAN_SLUG[catNorm];
  return 'default';
}

function catChipStyle(catNorm) {
  const s = catSlug(catNorm);
  return `background-color:var(--color-cat-${s}-bg);color:var(--color-cat-${s}-fg);`;
}

function catHex(catNorm, shade = 'mid') {
  return token(`color-cat-${catSlug(catNorm)}-${shade}`);
}

let catInited        = false;
let catSelectedMonth = '';          // mirror of lensMonth (legacy reads)
let catCompareMonth  = '';          // mirror of lensCompare (legacy reads)
let catAllMonths     = [];
let catDetailCache   = {};          // key: "level||category||month"
let catBubblePositions = [];        // positions array for current bubble chart
let catPrimaryBubbleDsIdx = 0;      // Chart.js dataset index of primary (colored) bubbles

function prevMonthStr(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return '';
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}


function buildCategoriesTabUI() {
  const ddSec  = document.getElementById('cat-drilldown-section');

  // Drill-down skeleton — content is filled in by renderDrillDown().
  ddSec.innerHTML = `
    <div id="dd-inner" class="bg-white border border-neutral-200 rounded-lg p-6 flex flex-col gap-6">

      <!-- Header — category identity + the focused month (side-by-side has no
           flyout title, so the month label lives here). -->
      <div class="flex items-center gap-3 min-w-0">
        <span id="dd-color-dot" class="w-10 h-10 rounded-full flex-none inline-flex items-center justify-center text-xl"></span>
        <div class="min-w-0">
          <h3 id="dd-cat-name" class="font-bold text-2xl text-neutral-500 truncate leading-tight"></h3>
          <p id="dd-month-heading" class="text-sm text-neutral-500"></p>
        </div>
      </div>

      <!-- Row 1: pie + quick stats, stacked (the drill-down pane is narrow). -->
      <div class="grid grid-cols-1 gap-6">
        <!-- Pie card: col 1-2 -->
        <div class="col-span-1 md:col-span-2 bg-white border border-neutral-200 rounded-lg shadow-sm overflow-hidden flex flex-col">
          <div class="px-6 pt-6 pb-3 shrink-0 flex flex-col items-start gap-3">
            <p id="dd-pie-title" class="font-semibold text-xl text-neutral-900 leading-snug min-w-0"></p>
            <div id="dd-pie-mode-toggle" role="group" aria-label="Pie chart view"
                 class="hidden rounded-lg border border-neutral-300 overflow-hidden text-xs shadow-sm shrink-0">
              <button data-pie-mode="proportion"  type="button" aria-pressed="true"
                class="dd-pie-mode-btn px-3 py-1.5 font-semibold bg-neutral-100 text-neutral-900 font-semibold">Proportion</button>
              <button data-pie-mode="composition" type="button" aria-pressed="false"
                class="dd-pie-mode-btn px-3 py-1.5 font-semibold text-neutral-500 hover:bg-neutral-50">Composition</button>
            </div>
          </div>
          <div class="flex-1 px-6 pb-4">
            <div id="dd-pie" class="w-full" style="height:320px"></div>
          </div>
        </div>

        <!-- Quick stats: col 3-5, KPI-style cards. Transactions + Avg Transaction
             sit side-by-side; Most Active Day spans the full row below them. -->
        <div id="dd-quick-stats" class="col-span-1 md:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-4 self-stretch"></div>
      </div>

      <!-- Row 2: cumulative chart + top locations, stacked. -->
      <div class="grid grid-cols-1 gap-5">
        <!-- Cumulative chart: col 1-3 -->
        <div class="col-span-1 md:col-span-3 bg-white border border-neutral-200 rounded-lg shadow-sm flex flex-col">
          <div class="px-6 pt-6 pb-0 flex items-center justify-between shrink-0">
            <p id="dd-cumul-title" class="font-semibold text-xl text-neutral-900"></p>
            <p id="dd-compare-legend" class="hidden text-xs text-neutral-500 italic"></p>
          </div>
          <div class="flex-1 px-6 pb-6 pt-3">
            <!-- Height is set in JS (renderDdCumulative) per viewport — Chart.js
                 maintainAspectRatio:false fills this box, so it needs a definite height. -->
            <div id="dd-cumulative" class="w-full"></div>
          </div>
        </div>

        <!-- Top locations: col 4-5 (title swaps by scope: Top Categories for all/parent, Top Locations for leaf) -->
        <div class="col-span-1 md:col-span-2 bg-white border border-neutral-200 rounded-lg shadow-sm flex flex-col">
          <div class="px-6 pt-6 pb-0 shrink-0">
            <p id="dd-locations-title" class="font-semibold text-xl text-neutral-900">Top Locations</p>
          </div>
          <div class="px-6 pt-4 pb-6">
            <div id="dd-locations" class="flex flex-col gap-3.5"></div>
          </div>
        </div>
      </div>

      <!-- Row 3: full-width bubble chart -->
      <div class="bg-white border border-neutral-200 rounded-lg shadow-sm">
        <div class="px-6 pt-6 pb-0 flex items-center justify-between">
          <p id="dd-bubble-title" class="font-semibold text-xl text-neutral-900"></p>
          <div id="dd-bubble-legend" class="hidden flex items-center gap-4 text-xs text-neutral-500"></div>
        </div>
        <div class="px-6 pb-6 pt-4">
          <div id="dd-bubble" class="w-full" style="height:260px;overflow:hidden"></div>
        </div>
      </div>

      <!-- Row 4: transaction table(s) — rendered dynamically by renderDdTable -->
      <div id="dd-table-outer"></div>

    </div>
  `;

  // Drill-down is always visible (no hidden class added here)
}

function syncCompareOptions() {
  const compareSel = document.getElementById('cat-compare-sel');
  if (!compareSel) return;
  compareSel.querySelectorAll('option').forEach(opt => {
    opt.disabled = opt.value !== '' && opt.value === catSelectedMonth;
  });
  // If compare is set to the same month as the active month, clear it.
  if (catCompareMonth && catCompareMonth === catSelectedMonth) {
    catCompareMonth = '';
    lensCompare = '';
    compareSel.value = '';
    renderHabitsChart();
    renderDrillDown();
  }
}

// ── Drill-down (scope-aware) ──────────────────────────────────────────────────
async function renderDrillDown() {
  if (!lensMonth) return;

  // Static tree: one file per scope, with every month keyed inside.
  const scopeFile = `category-detail-${scopeSlug(lensLevel, lensCategory)}.json`;
  const key = `${lensLevel}||${lensCategory}||${lensMonth}`;
  if (!catDetailCache[key]) {
    const file = await fetchJsonCached(scopeFile);
    catDetailCache[key] = (file.months || {})[lensMonth] || null;
  }
  const data = catDetailCache[key];

  let compareData = null;
  if (lensCompare && lensChartView !== 'stacked' && lensCompare !== lensMonth) {
    const cKey = `${lensLevel}||${lensCategory}||${lensCompare}`;
    if (!catDetailCache[cKey]) {
      try {
        const file = await fetchJsonCached(scopeFile);
        catDetailCache[cKey] = (file.months || {})[lensCompare] || null;
      } catch (e) { catDetailCache[cKey] = null; }
    }
    compareData = catDetailCache[cKey];
  }

  renderDrillDownView(data, compareData);
}

function renderDrillDownView(data, compareData) {
  if (!data) return;
  // Clear any tooltip stranded by the previous render's chart teardown.
  hideCustomTooltip();
  hideCjsTip();

  const monthLabel = formatMonthLabel(data.year_month);
  const level = data.level || 'leaf';
  const headerName = data.category;

  // Header dot + name. For 'all' scope, use a neutral default chip.
  const headerDot = document.getElementById('dd-color-dot');
  if (headerDot) {
    if (level === 'all') {
      headerDot.setAttribute('style', `background-color:var(--color-cat-default-bg);color:var(--color-cat-default-fg);`);
      headerDot.innerHTML = `<span class="cat-emoji" aria-hidden="true" style="margin-right:0">📊</span>`;
    } else {
      headerDot.setAttribute('style', catChipStyle(headerName));
      headerDot.innerHTML = `<span class="cat-emoji" aria-hidden="true" style="margin-right:0">${catEmoji(headerName)}</span>`;
    }
  }
  document.getElementById('dd-cat-name').textContent = headerName;
  const ddMonthHeading = document.getElementById('dd-month-heading');
  if (ddMonthHeading) ddMonthHeading.textContent = `${monthLabel} in detail`;

  // Locations card title swaps by scope.
  const locTitle = document.getElementById('dd-locations-title');
  if (locTitle) {
    locTitle.textContent = level === 'all'    ? 'Top Categories'
                         : level === 'parent' ? 'Top Categories'
                         :                      'Top Locations';
  }

  // Cumulative + bubble titles include scope label.
  const cumTitle = document.getElementById('dd-cumul-title');
  if (cumTitle) cumTitle.textContent = `Cumulative Spend — ${monthLabel}`;
  const bubTitle = document.getElementById('dd-bubble-title');
  if (bubTitle) bubTitle.textContent = `Transaction Bubbles — ${monthLabel}`;

  // Pick a primary color for the category being scoped (default-gray for 'all').
  // 'all' scope drives the cumulative line + bubble color in brand indigo (accent-700).
  const color = level === 'all' ? token('color-accent-700') : catHex(headerName);

  renderDdPie(data, color);
  renderDdQuickStats(data, lensCompare ? compareData : null);
  renderDdLocations(data.top_locations, color, level);
  renderDdCumulative(data, compareData, color);
  renderDdBubble(data, lensCompare ? compareData : null, color);
  renderDdTable(data, lensCompare ? compareData : null);
}

function renderDdPie(data, color) {
  hideCustomTooltip();
  // Cache for cheap toggle re-render (no re-fetch).
  _ddLastData  = data;
  _ddLastColor = color;

  const titleEl = document.getElementById('dd-pie-title');
  const pieEl   = document.getElementById('dd-pie');
  const level = data.level || 'leaf';
  const monthLabel = formatMonthLabel(data.year_month);

  // At parent scope, decide whether Composition is even a valid mode this month.
  // (Used to disable the toggle button and force-fallback to Proportion.)
  const childCount = level === 'parent'
    ? (data.by_child || []).filter(c => (c.total || 0) > 0).length
    : 0;
  const effectiveMode = (level === 'parent' && childCount > 1) ? ddPieMode : 'proportion';

  // Sync the toggle UI to the current scope + childCount.
  updateDdPieToggleUI(level, childCount);

  // Empty-data placeholder for non-all scopes — an empty donut reads as a bug.
  if (level !== 'all' && (data.total || 0) === 0) {
    if (titleEl) titleEl.textContent = `${data.category} — ${monthLabel}`;
    if (pieEl) {
      destroyChart('dd-pie');
      pieEl.innerHTML = `<div class="h-full w-full flex items-center justify-center text-sm text-neutral-500">No spending in ${monthLabel}</div>`;
    }
    return;
  }

  // Compose pie data per (level, effectiveMode).
  let labels = [];
  let values = [];
  let colors = [];
  let titleText = '';

  if (level === 'all') {
    titleText = `All spending in ${monthLabel}`;
    (data.by_parent || []).forEach(item => {
      labels.push(item.name);
      values.push(item.total);
      colors.push(item.name === 'Other' ? token('color-cat-default-mid') : catHex(item.name, 'mid'));
    });
  } else if (level === 'parent' && effectiveMode === 'composition') {
    titleText = `${data.category} — by category`;
    const children = data.by_child || [];
    children.forEach((item, idx) => {
      labels.push(item.name);
      values.push(item.total);
      colors.push(derivedShade(catHex(data.category, 'mid'), idx, children.length));
    });
  } else {
    // Proportion mode (parent and leaf share visuals).
    titleText = `${data.category} was ${data.pct_of_total}% of your total spend in ${monthLabel}`;
    const otherTotal = Math.max(0, (data.month_total || 0) - (data.total || 0));
    const sliceColor = level === 'parent' ? catHex(data.category, 'mid') : color;
    labels = [data.category, 'Rest of month'];
    values = [data.total, otherTotal];
    colors = [sliceColor, token('color-gray-100')];
  }

  if (titleEl) titleEl.textContent = titleText;

  // Clear any leftover placeholder (from a prior empty-state render) so
  // getChartCanvas can create a fresh canvas.
  if (pieEl && !pieEl.querySelector('canvas')) pieEl.innerHTML = '';

  // Compositional views label every slice and act as a navigation surface.
  // Proportion mode + leaf scope keep clean (no labels, no click drill).
  const isComposition = (level === 'all') || (level === 'parent' && effectiveMode === 'composition');
  const total = values.reduce((a, b) => a + (b || 0), 0);

  const base = chartLayout();
  mountChart('dd-pie', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: token('color-white'),
        borderWidth: 1,
      }],
    },
    options: {
      ...base,
      cutout: '60%',
      // Outside labels (composition) need breathing room around the donut.
      layout: { padding: isComposition ? 28 : 8 },
      scales: {},   // doughnut has no axes
      onClick: (evt, elements) => {
        // Click-to-drill on compositional donuts: all → parent, parent → leaf.
        // "Other" rollup at all-scope is a no-op (synthetic top-N bucket).
        if (!isComposition || !elements.length) return;
        const sliceLabel = labels[elements[0].index];
        if (!sliceLabel) return;
        if (level === 'all') { if (sliceLabel !== 'Other') setScopeParent(sliceLabel); }
        else if (level === 'parent') setScopeLeaf(sliceLabel);
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false, external: makeTipExternal(cjsTipPie) },
        datalabels: isComposition ? {
          display: (ctx) => total > 0 && (ctx.dataset.data[ctx.dataIndex] / total) >= 0.04,
          anchor: 'end', align: 'end', offset: 6,
          color: token('color-gray-700'),
          font: { size: 11, weight: '600' },
          formatter: (value, ctx) => {
            const label = ctx.chart.data.labels[ctx.dataIndex];
            const pct = total > 0 ? Math.round((value / total) * 100) : 0;
            return `${label}\n${pct}%`;
          },
        } : { display: false },
      },
    },
  });
  setChartA11y('dd-pie', `${data.category || 'All spending'} composition donut, ${labels.length} segment${labels.length !== 1 ? 's' : ''}`);
}

// Pie tooltip spec — handles compositional ("Other"/named slice) and proportion
// ("Rest of month") cases. Percent is computed from the dataset total.
function cjsTipPie(ctx) {
  const dp = ctx.tooltip.dataPoints?.[0];
  if (!dp) return null;
  const sliceLabel = dp.label || '';
  const value = fmt(dp.parsed || 0);
  const allValues = dp.dataset.data || [];
  const total = allValues.reduce((a, b) => a + (b || 0), 0);
  const pct = total > 0 ? Math.round((dp.parsed / total) * 100) : 0;
  const monthLabel = lensMonth ? formatMonthLabel(lensMonth) : '';
  const meta = monthLabel ? `${pct}% of Total ${monthLabel} Spend` : `${pct}% of Total Spend`;

  if (sliceLabel === 'Rest of month') return { title: 'Rest of month', meta, value };
  if (sliceLabel === 'Other')        return { accentSlug: 'default', title: 'Other', meta, value };
  return { accentSlug: catSlug(sliceLabel), title: tipCatBadge(sliceLabel), meta, value };
}

// Show/hide and style the Proportion/Composition toggle. `level` is the
// current scope; `childCount` is how many children of the active parent have
// non-zero spend in the focused month (only meaningful when level==='parent').
function updateDdPieToggleUI(level, childCount) {
  const toggle = document.getElementById('dd-pie-mode-toggle');
  if (!toggle) return;

  if (level !== 'parent') {
    toggle.classList.add('hidden');
    return;
  }
  toggle.classList.remove('hidden');
  toggle.classList.add('flex');

  const propBtn = toggle.querySelector('[data-pie-mode="proportion"]');
  const compBtn = toggle.querySelector('[data-pie-mode="composition"]');
  const compDisabled = (childCount || 0) <= 1;

  // Effective mode (matches the render's effectiveMode logic).
  const activeMode = compDisabled ? 'proportion' : ddPieMode;

  const setActive = (btn, isActive) => {
    btn.classList.toggle('bg-neutral-100',   isActive);
    btn.classList.toggle('text-neutral-900', isActive);
    btn.classList.toggle('font-semibold',    isActive);
    btn.classList.toggle('text-neutral-500',    !isActive);
    btn.classList.toggle('hover:bg-neutral-50', !isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  };
  setActive(propBtn, activeMode === 'proportion');
  setActive(compBtn, activeMode === 'composition');

  // Composition disabled state: greyed + not clickable when there's nothing to compose.
  compBtn.disabled = compDisabled;
  compBtn.classList.toggle('opacity-40',         compDisabled);
  compBtn.classList.toggle('cursor-not-allowed', compDisabled);
}

function renderDdQuickStats(data, prevData) {
  const container = document.getElementById('dd-quick-stats');
  container.innerHTML = '';

  const txns = data.transactions || [];

  // Avg transaction description: range
  let avgDesc = '';
  if (txns.length > 1) {
    const amounts = txns.map(t => t.amount);
    avgDesc = `Ranged from ${fmt(Math.min(...amounts))} to ${fmt(Math.max(...amounts))}`;
  }

  // Most active day description: count of transactions on that day
  const dowName = data.most_frequent_dow || '';
  let dowDesc = '';
  if (dowName && txns.length) {
    const dowCount = txns.filter(t => DOW_LABELS[new Date(t.date + 'T12:00:00').getDay()] === dowName).length;
    dowDesc = `You shopped on ${dowCount} ${dowName}${dowCount !== 1 ? 's' : ''} this month`;
  }

  // Transactions description: avg days between shops
  let txnDesc = '';
  if (txns.length > 1) {
    const dates = txns.map(t => new Date(t.date + 'T12:00:00')).sort((a, b) => a - b);
    const spanDays = (dates[dates.length - 1] - dates[0]) / 86400000;
    const avgGap = Math.round(spanDays / (txns.length - 1));
    txnDesc = avgGap <= 1
      ? 'You shopped almost every day'
      : `About every ${avgGap} day${avgGap !== 1 ? 's' : ''} on average`;
  }

  const stats = [
    {
      label: 'Transactions',
      value: data.transaction_count,
      fmtFn: v => v.toLocaleString(),
      prev:  prevData ? prevData.transaction_count : null,
      desc:  txnDesc,
    },
    {
      label: 'Avg Transaction',
      value: data.avg_transaction,
      fmtFn: fmt,
      prev:  prevData ? prevData.avg_transaction : null,
      desc:  avgDesc,
    },
    {
      label: 'Most Active Day',
      value: data.most_frequent_dow,
      fmtFn: v => String(v),
      prev:  null,
      desc:  dowDesc,
    },
  ];

  stats.forEach((stat, idx) => {
    const card = document.createElement('div');
    // KPI-strip mimicry: vertical stack — eyebrow on top, big value below,
    // description right under, delta + comparison line bottom-anchored.
    // The 3rd card (Most Active Day) spans both columns on the row below.
    const colSpan = idx === 2 ? ' sm:col-span-2' : '';
    card.className = `bg-white rounded-lg border border-neutral-200 shadow-sm p-6 flex flex-col h-full${colSpan}`;

    let badgeHtml = '';
    let subHtml   = '';

    if (stat.prev !== null && typeof stat.value === 'number' && stat.prev > 0) {
      const pctChange = ((stat.value - stat.prev) / stat.prev) * 100;
      const up = pctChange > 0;
      const sign = up ? '+' : '';
      const badgeColor = up
        ? 'text-utility-red-700 bg-utility-red-50'
        : 'text-utility-green-700 bg-utility-green-50';
      const arrow = up ? '↑' : '↓';
      badgeHtml = `<span class="inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${badgeColor}">${arrow} ${sign}${Math.abs(pctChange).toFixed(0)}%</span>`;
      const compareLabel = catCompareMonth ? formatMonthLabel(catCompareMonth) : 'prev';
      subHtml = `<span class="text-xs text-neutral-500">vs ${escHtml(stat.fmtFn(stat.prev))} (${compareLabel})</span>`;
    }

    const descHtml = stat.desc
      ? `<p class="text-sm text-neutral-500 mt-1">${escHtml(stat.desc)}</p>`
      : '';
    const footHtml = (badgeHtml || subHtml)
      ? `<div class="mt-auto pt-4 flex items-center gap-2">${badgeHtml}${subHtml}</div>`
      : '';

    card.innerHTML = `
      <p class="text-base font-semibold text-neutral-500">${escHtml(stat.label)}</p>
      <p class="text-5xl font-semibold text-neutral-900 tabular-nums tracking-tight mt-1 truncate">${escHtml(String(stat.fmtFn(stat.value)))}</p>
      ${descHtml}
      ${footHtml}
    `;
    container.appendChild(card);
  });
}

function renderDdLocations(locations, color, level = 'leaf') {
  const container = document.getElementById('dd-locations');
  container.innerHTML = '';
  if (!locations || !locations.length) {
    container.innerHTML = '<p class="text-xs text-neutral-500">No data</p>';
    return;
  }
  // For category-level rows (parent → children, all → parents) show colored chips;
  // for merchant rows (leaf scope) keep the simple text+amount layout.
  const showChip = level === 'parent' || level === 'all';
  locations.forEach(loc => {
    const el = document.createElement('div');
    el.className = 'flex items-center justify-between py-0.5 gap-2';
    if (showChip) {
      const isOther = loc.name === 'Other';
      const chipStyle = isOther ? `background-color:var(--color-cat-default-bg);color:var(--color-cat-default-fg);` : catChipStyle(loc.name);
      const chipBody = isOther ? escHtml(loc.name) : catLabelHtml(loc.name);
      el.innerHTML = `
        <span class="inline-flex items-center text-sm px-2.5 py-1 rounded-full whitespace-nowrap" style="${chipStyle}">${chipBody}</span>
        <span class="text-sm font-medium text-neutral-900 tabular-nums ml-auto shrink-0">${fmt(loc.total)}</span>
      `;
    } else {
      // Leaf scope (merchant rows) — let names wrap naturally; no width clip.
      el.innerHTML = `
        <span class="text-sm text-neutral-700 font-medium" title="${escHtml(loc.name)}">${escHtml(loc.name)}</span>
        <span class="text-sm font-medium text-neutral-900 tabular-nums ml-2 shrink-0">${fmt(loc.total)}</span>
      `;
    }
    container.appendChild(el);
  });
}

function renderDdCumulative(data, compareData, color) {
  hideCustomTooltip();

  // Numeric day-of-month axis (1..daysInMonth) — matches the bubble chart's
  // calendar so both read alike. Series are mapped onto that day index, padded
  // with null past their last posted day so the line stops cleanly.
  const [yr, mo] = data.year_month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const seriesByDay = (rows) => {
    const arr = Array(daysInMonth).fill(null);
    rows.forEach(d => { arr[parseInt(d.date.split('-')[2], 10) - 1] = d.cumulative; });
    return arr;
  };

  const datasets = [{
    label: formatMonthLabel(data.year_month),
    data: seriesByDay(data.cumulative_spend),
    borderColor: color,
    borderWidth: 2.5,
    pointRadius: 0,            // baseline: no dots — the hover dot is drawn natively
    pointHoverRadius: 9,
    pointHoverBackgroundColor: color,
    pointHoverBorderColor: token('color-white'),
    pointHoverBorderWidth: 2,
    tension: 0,
    spanGaps: true,
    _compare: false,
  }];

  const legendEl = document.getElementById('dd-compare-legend');
  if (legendEl) legendEl.classList.add('hidden');

  if (compareData) {
    datasets.push({
      label: formatMonthLabel(compareData.year_month),
      data: seriesByDay(compareData.cumulative_spend),
      borderColor: token('color-gray-400'),
      borderWidth: 2,
      borderDash: [2, 2],
      pointRadius: 0,
      pointHoverRadius: 0,     // compare overlay has no tracking dot (matches old 'lines' mode)
      tension: 0,
      spanGaps: true,
      _compare: true,
    });
  }

  // Explicit height — Chart.js (maintainAspectRatio:false) fills this box.
  const cumEl = document.getElementById('dd-cumulative');
  if (cumEl) cumEl.style.height = (window.innerWidth < 768 ? 200 : 220) + 'px';

  const base = chartLayout();
  mountChart('dd-cumulative', {
    type: 'line',
    data: { labels, datasets },
    options: {
      ...base,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { ...base.scales.x,
             ticks: { ...base.scales.x.ticks,
                      maxRotation: 45, minRotation: 45,
                      callback: (v, i) => `${MONTH_LABELS[mo - 1]} ${labels[i]}` } },
        y: { ...base.scales.y, beginAtZero: true },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false, external: makeTipExternal(cjsTipCumul) },
      },
    },
  });
  setChartA11y('dd-cumulative', `${data.category || 'All spending'} cumulative spend by day${compareData ? ', with prior-period overlay' : ''}`);
}

// Cumulative line tooltip spec — distinguishes the primary line from the dotted
// compare overlay (dataset._compare flag).
function cjsTipCumul(ctx) {
  const dp = ctx.tooltip.dataPoints?.[0];
  if (!dp) return null;
  const ds = dp.dataset;
  const value = fmt(dp.parsed.y || 0);
  return {
    title: `Day ${dp.label}`,
    meta: ds.label || '',
    value: ds._compare ? `Last month: ${value}` : value,
  };
}

function renderDdBubble(data, compareData, color) {
  hideCustomTooltip();
  catBubblePositions = [];

  // Mobile (<768px): the bubble layout is too dense to tap — swap in the
  // daily-totals strip (M8) and bail. The matchMedia listener re-renders on
  // breakpoint cross, so resizing across 768 swaps the two cleanly.
  if (window.innerWidth < 768) { renderDdDailyStrip(data, color); return; }

  const bubEl = document.getElementById('dd-bubble');
  const txns = data.transactions;
  if (!txns || !txns.length) {
    destroyChart('dd-bubble');
    if (bubEl) bubEl.innerHTML = '<p class="text-xs text-neutral-500 text-center pt-10">No transactions</p>';
    return;
  }
  // Clear any leftover placeholder/strip so getChartCanvas builds a fresh canvas.
  if (bubEl && !bubEl.querySelector('canvas')) bubEl.innerHTML = '';

  const GAP      = 4;   // px gap between touching bubbles
  const MIN_SIZE = 10;  // px minimum diameter
  const MAX_SIZE = 44;  // px maximum diameter
  const MARGIN_B = 16;  // px bottom margin

  const compareTxns = compareData && compareData.transactions ? compareData.transactions : [];
  const maxAmt = Math.max(...txns.map(t => t.amount), ...compareTxns.map(t => t.amount));

  // Stack transactions per day into pixel coordinates (unchanged from v1 —
  // Chart.js's bubble type can't do per-day pixel stacking, so we keep the math
  // and feed Chart.js the resulting x/y/r directly).
  function stackPositions(transactions) {
    const positions = [];
    const byDay = {};
    transactions.forEach((t, i) => {
      const day = parseInt(t.date.split('-')[2], 10);
      (byDay[day] ||= []).push({ ...t, origIndex: i });
    });
    Object.entries(byDay).forEach(([day, dayTxns]) => {
      dayTxns.sort((a, b) => b.amount - a.amount);
      let stackY = MARGIN_B;
      dayTxns.forEach(t => {
        const size = MIN_SIZE + (t.amount / maxAmt) * (MAX_SIZE - MIN_SIZE);
        const r = size / 2;
        const cy = stackY + r;
        stackY = cy + r + GAP;
        positions.push({ ...t, x: parseInt(day, 10), y: cy, size });
      });
    });
    return positions;
  }

  catBubblePositions = stackPositions(txns);
  const comparePositions = compareTxns.length ? stackPositions(compareTxns) : [];

  // Legend (compare mode only)
  const legendEl = document.getElementById('dd-bubble-legend');
  if (legendEl) {
    if (comparePositions.length) {
      legendEl.innerHTML = `
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${color};opacity:0.72"></span>
          ${escHtml(formatMonthLabel(data.year_month))}
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-neutral-400" style="opacity:0.45"></span>
          ${escHtml(formatMonthLabel(compareData.year_month))}
        </span>
      `;
      legendEl.classList.remove('hidden');
    } else {
      legendEl.classList.add('hidden');
    }
  }

  // Dynamic height: tallest stack across both sets (y is a pixel coordinate).
  const allPositions = [...catBubblePositions, ...comparePositions];
  const maxY = Math.max(...allPositions.map(p => p.y + p.size / 2));
  const chartH = Math.max(220, Math.ceil(maxY) + 24);
  if (bubEl) bubEl.style.height = chartH + 'px';

  const [yr, mo] = data.year_month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();

  const toPoints = (positions, extra = {}) => positions.map(p => ({
    x: p.x, y: p.y, r: p.size / 2,
    name: p.name, amountStr: fmt(p.amount), date: p.date,
    origIndex: p.origIndex, ...extra,
  }));

  const datasets = [];
  // Compare dataset (grey) — pushed first so it draws behind the primary.
  if (comparePositions.length) {
    datasets.push({
      label: formatMonthLabel(compareData.year_month),
      data: toPoints(comparePositions, { isCompare: true }),
      backgroundColor: hexToRgba(token('color-gray-400'), 0.45),
      borderColor: 'rgba(255,255,255,0.7)', borderWidth: 1,
      _noHighlight: true,
    });
  }
  // Primary dataset (colored, on top). Per-point backgroundColor array so the
  // hover-sync helpers can dim/lift individual bubbles.
  catPrimaryBubbleDsIdx = datasets.length;
  const base = hexToRgba(color, 0.72);
  datasets.push({
    label: formatMonthLabel(data.year_month),
    data: toPoints(catBubblePositions),
    backgroundColor: catBubblePositions.map(() => base),
    borderColor: 'rgba(255,255,255,0.9)', borderWidth: 1.5,
    _base: base, _full: hexToRgba(color, 1), _dim: hexToRgba(color, 0.18),
  });

  const layoutBase = chartLayout();
  const chart = mountChart('dd-bubble', {
    type: 'bubble',
    data: { datasets },
    options: {
      ...layoutBase,
      interaction: { mode: 'nearest', intersect: true },
      scales: {
        x: { type: 'linear', min: 0.5, max: daysInMonth + 0.5,
             grid: { display: false },
             ticks: { color: token('color-gray-500'), font: { size: 10 },
                      stepSize: 1, autoSkip: true, maxTicksLimit: 10,
                      callback: (v) => Number.isInteger(v) ? `${MONTH_LABELS[mo - 1]} ${v}` : '' } },
        y: { min: 0, max: chartH, display: false },
      },
      onHover: (evt, els, ch) => {
        const el = els.find(e => e.datasetIndex === catPrimaryBubbleDsIdx);
        const idx = el ? (catBubblePositions[el.index]?.origIndex ?? -1) : -1;
        if (ch.$lastBubble === idx) return;
        ch.$lastBubble = idx;
        if (idx >= 0) highlightBubble(idx); else clearBubbleHighlight();
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false, external: makeTipExternal(cjsTipBubble) },
      },
    },
  });
  if (chart) chart.$lastBubble = -1;
  setChartA11y('dd-bubble', `${data.category || 'All spending'} merchants by day, ${MONTH_LABELS[mo - 1]} ${yr}, bubble chart`);
}

// Bubble↔table hover sync (both directions call these). Lift the matching
// primary bubble + its table row; dim the rest.
function highlightBubble(idx) {
  document.querySelectorAll('#dd-table-body tr').forEach(row => {
    row.classList.toggle('bg-neutral-100', Number(row.dataset.idx) === idx);
  });
  const chart = _charts['dd-bubble'];
  if (!chart || !catBubblePositions.length) return;
  const ds = chart.data.datasets[catPrimaryBubbleDsIdx];
  if (!ds) return;
  ds.backgroundColor = catBubblePositions.map(p => p.origIndex === idx ? ds._full : ds._dim);
  chart.update('none');
}
function clearBubbleHighlight() {
  document.querySelectorAll('#dd-table-body tr').forEach(r => r.classList.remove('bg-neutral-100'));
  const chart = _charts['dd-bubble'];
  if (!chart || !catBubblePositions.length) return;
  const ds = chart.data.datasets[catPrimaryBubbleDsIdx];
  if (!ds) return;
  ds.backgroundColor = catBubblePositions.map(() => ds._base);
  chart.update('none');
}

// Mobile-only daily-totals strip (M8): one thin bar per day-of-month, derived by
// first-differencing the cumulative_spend series. Purely visual — no tooltip, no
// click. Replaces the bubble chart below 768px.
function renderDdDailyStrip(data, color) {
  const el = document.getElementById('dd-bubble');
  if (!el) return;
  if (el.querySelector && !el.querySelector('canvas')) el.innerHTML = '';

  const [yr, mo] = data.year_month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();

  // Forward-fill the cumulative series across every day, then diff into per-day spend.
  const cum = Array(daysInMonth).fill(null);
  (data.cumulative_spend || []).forEach(d => {
    const di = parseInt(d.date.split('-')[2], 10) - 1;
    if (di >= 0 && di < daysInMonth) cum[di] = d.cumulative;
  });
  let last = 0;
  const cumFilled = cum.map(v => (v != null ? (last = v) : last));
  const dayTotals = cumFilled.map((v, i) => Math.max(0, i === 0 ? v : v - cumFilled[i - 1]));
  const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  el.style.height = '80px';

  mountChart('dd-bubble', {
    type: 'bar',
    data: { labels, datasets: [{ data: dayTotals, backgroundColor: color,
                                 categoryPercentage: 1.0, barPercentage: 0.9 }] },
    options: {
      layout: { padding: { left: 0, right: 0, top: 4, bottom: 0 } },
      events: [],   // purely visual — no hover/click handling
      scales: {
        x: { grid: { display: false },
             ticks: { color: token('color-gray-500'), font: { size: 10 },
                      autoSkip: false,
                      callback: (v, i) => (i % 7 === 0 ? labels[i] : '') } },
        y: { display: false, beginAtZero: true },
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false }, datalabels: { display: false } },
    },
  });
  setChartA11y('dd-bubble', `${data.category || 'All spending'} daily spend strip, ${MONTH_LABELS[mo - 1]} ${yr}`);
}

// Bubble tooltip spec — merchant + date + amount from the point's custom fields.
function cjsTipBubble(ctx) {
  const dp = ctx.tooltip.dataPoints?.[0];
  if (!dp) return null;
  const raw = dp.raw || {};
  return {
    title: escHtml(raw.name || ''),
    meta: formatBubbleDate(raw.date),
    value: raw.amountStr || fmt(raw.y || 0),
  };
}

// Radial tooltip — year + month name + dollar value.
function tipRadialHTML(year, monthName, value) {
  return tipCard({
    title: `${year || ''}`,
    meta: monthName || '',
    value: fmt(value || 0),
  });
}

function renderDdTable(data, compareData) {
  const outer = document.getElementById('dd-table-outer');
  outer.innerHTML = '';

  const primaryTxns = data.transactions || [];
  const compareTxns = compareData ? (compareData.transactions || []) : [];
  const hasCompare  = compareTxns.length > 0;

  // Show a Category column only when the scope spans multiple leaves (i.e.
  // all-scope or parent-scope). At leaf scope, every row has the same
  // category so the column would just repeat itself.
  const showCategory = data.level !== 'leaf';
  const colCount     = showCategory ? 4 : 3;

  // Wrap in a grid when comparing, plain div otherwise
  const grid = document.createElement('div');
  grid.className = hasCompare ? 'grid grid-cols-2 gap-5' : '';
  outer.appendChild(grid);

  // Build one self-contained card per panel
  function buildCard(txns, panelMonth, isPrimary) {
    const card = document.createElement('div');
    card.className = 'bg-white border border-neutral-200 rounded-lg shadow-sm';

    // Card header
    const hdr = document.createElement('div');
    hdr.className = 'px-6 pt-6 pb-0';
    hdr.innerHTML = `<p class="font-semibold text-xl text-neutral-900">
      ${hasCompare ? escHtml(formatMonthLabel(panelMonth)) : `All Transactions — ${escHtml(formatMonthLabel(panelMonth))}`}
    </p>`;
    card.appendChild(hdr);

    // Scrollable table
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'px-6 pt-4 pb-6';

    const inner = document.createElement('div');
    inner.className = 'overflow-y-auto';
    inner.style.maxHeight = '320px';

    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    table.innerHTML = `
      <thead class="sticky top-0 bg-white">
        <tr class="border-b border-neutral-200">
          <th class="pb-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">Date</th>
          <th class="pb-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">Merchant</th>
          ${showCategory ? '<th class="pb-2 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">Category</th>' : ''}
          <th class="pb-2 text-right text-xs font-semibold text-neutral-500 uppercase tracking-wide">Amount</th>
        </tr>
      </thead>`;

    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-neutral-50';
    if (isPrimary) tbody.id = 'dd-table-body';

    if (!txns.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="text-center text-xs text-neutral-500 py-4">No transactions</td></tr>`;
    } else {
      txns.forEach((t, i) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-neutral-50 transition-colors cursor-default';
        if (isPrimary) tr.dataset.idx = i;
        const categoryCell = showCategory
          ? `<td class="py-2 pr-3"><span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full whitespace-nowrap" style="${catChipStyle(t.category || 'Uncategorized')}">${catLabelHtml(t.category || 'Uncategorized')}</span></td>`
          : '';
        tr.innerHTML = `
          <td class="py-2 pr-3 text-xs text-neutral-500 whitespace-nowrap">${t.date}</td>
          <td class="py-2 pr-3 text-sm text-neutral-700 font-medium truncate max-w-[110px]" title="${escHtml(t.name)}">${escHtml(t.name)}</td>
          ${categoryCell}
          <td class="py-2 text-right text-sm text-neutral-900 font-medium tabular-nums whitespace-nowrap">${fmt(t.amount)}</td>
        `;

        if (isPrimary) {
          tr.addEventListener('mouseenter', () => highlightBubble(i));
          tr.addEventListener('mouseleave', () => clearBubbleHighlight());
        }

        tbody.appendChild(tr);
      });
    }

    table.appendChild(tbody);
    inner.appendChild(table);
    scrollWrap.appendChild(inner);
    card.appendChild(scrollWrap);
    return card;
  }

  grid.appendChild(buildCard(primaryTxns, data.year_month, true));
  if (hasCompare) {
    grid.appendChild(buildCard(compareTxns, compareData.year_month, false));
  }
}

// ── Transactions ──────────────────────────────────────────────────────────────
let txnInited = false;
let _allTransactions = null;          // load-once cache (newest-first)
let txnVisibleMonths = 3;             // month-groups shown; "Load older" increments
let txnDayRange = null;               // { start_day, end_day } from an Overview linkout

function transactionsSubtitle() {
  const cat    = document.getElementById('txn-cat-filter')?.value || '';
  const month  = document.getElementById('txn-month-filter')?.value || '';
  const search = (document.getElementById('txn-search')?.value || '').trim();
  const parts = [];
  if (cat)    parts.push(cat);
  if (month)  parts.push(formatMonthLabel(month));
  if (search) parts.push(`matching "${search}"`);
  return parts.length ? parts.join(' · ') : 'All transactions';
}

function renderTransactionsHeader() {
  const titleEl = document.getElementById('page-title');
  const subEl   = document.getElementById('page-subtitle');
  if (titleEl) {
    titleEl.innerHTML =
        `<span class="block text-base font-semibold text-neutral-600 mb-1">Transactions</span>`
      + `Transactions`;
  }
  const subtitle = transactionsSubtitle();
  if (subEl) subEl.innerHTML = subtitle ? escHtml(subtitle) : '&nbsp;';
}

async function renderTransactionsTab() {
  if (!txnInited) {
    const cats = await fetchJsonCached('categories.json');
    const catSel = document.getElementById('txn-cat-filter');
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      catSel.appendChild(opt);
    });

    // A manual filter change resets the view to 3 months and clears any
    // day-range carried in from an Overview linkout.
    const onFilterChange = () => {
      txnVisibleMonths = 3;
      txnDayRange = null;
      updateTxnFilterBadge();
      renderTransactionsHeader();
      renderTransactions();
    };
    document.getElementById('txn-search').addEventListener('input', debounce(onFilterChange, 100));
    catSel.addEventListener('change', onFilterChange);
    document.getElementById('txn-month-filter').addEventListener('change', onFilterChange);
    document.getElementById('txn-filter-btn').addEventListener('click', openTxnFilterSheet);

    txnInited = true;
  }

  // Apply nav state from Overview-tab linkouts (client-side filters now).
  const nav = window.moneyHabitsNav;
  if (nav && nav.tab === 'transactions') {
    document.getElementById('txn-search').value       = '';
    document.getElementById('txn-cat-filter').value   = '';
    document.getElementById('txn-month-filter').value = nav.year_month || '';
    txnVisibleMonths = 3;
    txnDayRange = (nav.start_day != null && nav.end_day != null)
      ? { start_day: nav.start_day, end_day: nav.end_day }
      : null;
    window.moneyHabitsNav = null;
  }

  // Load the whole list once (chips also need the category→parent map).
  if (!_allTransactions) {
    await loadCategoryMeta();
    const data = await fetchJsonCached('transactions.json');
    _allTransactions = data.rows || [];
  }

  updateTxnFilterBadge();
  renderTransactionsHeader();
  renderTransactions();
}

// Client-side filter over the cached list (search ∧ category ∧ month ∧ day-range).
function getFilteredTransactions() {
  const search = (document.getElementById('txn-search')?.value || '').trim().toLowerCase();
  const cat    = document.getElementById('txn-cat-filter')?.value || '';
  const month  = document.getElementById('txn-month-filter')?.value || '';
  let rows = _allTransactions || [];
  if (search) rows = rows.filter(t => (t.name || '').toLowerCase().includes(search));
  if (cat)    rows = rows.filter(t => t.category === cat);
  if (month)  rows = rows.filter(t => t.date.slice(0, 7) === month);
  if (txnDayRange) rows = rows.filter(t => {
    const d = parseInt(t.date.slice(8, 10), 10);
    return d >= txnDayRange.start_day && d <= txnDayRange.end_day;
  });
  return rows;
}

// Group newest-first rows into [{ ym, rows }] ordered newest-month-first.
function groupByMonth(rows) {
  const groups = new Map();
  rows.forEach(t => {
    const ym = t.date.slice(0, 7);
    (groups.get(ym) || groups.set(ym, []).get(ym)).push(t);
  });
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ym, r]) => ({ ym, rows: r }));
}

function renderTransactions() {
  const list = document.getElementById('txn-list');
  const olderWrap = document.getElementById('txn-load-older-wrap');
  if (!list) return;

  const search = (document.getElementById('txn-search')?.value || '').trim();
  const groups = groupByMonth(getFilteredTransactions());

  if (!groups.length) {
    list.innerHTML = `<p class="text-sm text-neutral-500 py-12 text-center">No transactions found.</p>`;
    if (olderWrap) olderWrap.innerHTML = '';
    return;
  }

  list.innerHTML = groups.slice(0, txnVisibleMonths)
    .map(g => monthGroupHTML(g, search)).join('');

  // "Load older" → next month-group with matches (empty months are skipped
  // because groupByMonth only emits months that have rows).
  if (olderWrap) {
    olderWrap.innerHTML = '';
    if (groups.length > txnVisibleMonths) {
      const next = groups[txnVisibleMonths];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'px-6 py-3 rounded-lg border border-neutral-200 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent-700';
      btn.textContent = `Load ${formatMonthLabel(next.ym)} →`;
      btn.addEventListener('click', () => { txnVisibleMonths++; renderTransactions(); });
      olderWrap.appendChild(btn);
    }
  }
}

function monthGroupHTML({ ym, rows }, search) {
  const n = rows.length;
  const count = search
    ? `${n} transaction${n !== 1 ? 's' : ''} matching "${escHtml(search)}"`
    : `${n} transaction${n !== 1 ? 's' : ''}`;
  return `
    <div class="mb-8">
      <h3 class="text-base font-semibold text-neutral-600 px-1 pt-2 pb-3">
        ${escHtml(formatMonthLabel(ym))} <span class="text-neutral-400 font-normal">· ${count}</span>
      </h3>
      <div class="bg-white rounded-lg border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
        ${rows.map(txnRowHTML).join('')}
      </div>
    </div>`;
}

// One row, two layouts: stacked (<768px) and table-grid (≥768px).
function txnRowHTML(t) {
  const chip = `<span class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full max-w-full truncate" style="${catChipStyle(t.category)}">${catLabelHtml(t.category)}</span>`;
  return `
    <div class="px-4 py-3 hover:bg-neutral-50 transition-colors">
      <!-- Mobile: name + amount, then chip + date -->
      <div class="md:hidden">
        <div class="flex items-center justify-between gap-3">
          <span class="text-base font-medium text-neutral-900 truncate">${escHtml(t.name)}</span>
          <span class="text-base font-semibold tabular-nums text-neutral-900 shrink-0">${fmt(t.amount)}</span>
        </div>
        <div class="flex items-center justify-between gap-3 mt-1.5">
          ${chip}
          <span class="text-xs text-neutral-500 shrink-0">${formatTxnDate(t.date)}</span>
        </div>
      </div>
      <!-- Desktop: Date | Merchant | Category | Account | Amount -->
      <div class="hidden md:grid md:grid-cols-[7rem_minmax(0,1fr)_12rem_10rem_6rem] md:items-center md:gap-4">
        <span class="text-sm text-neutral-500 whitespace-nowrap">${formatTxnDate(t.date)}</span>
        <span class="text-sm font-medium text-neutral-800 truncate">${escHtml(t.name)}</span>
        <span class="min-w-0">${chip}</span>
        <span class="text-xs text-neutral-500 truncate">${escHtml(t.account || '')}</span>
        <span class="text-sm font-medium text-neutral-800 text-right tabular-nums whitespace-nowrap">${fmt(t.amount)}</span>
      </div>
    </div>`;
}

// Count of active sheet filters (category + month; search is always visible).
function txnActiveFilterCount() {
  let n = 0;
  if (document.getElementById('txn-cat-filter')?.value)   n++;
  if (document.getElementById('txn-month-filter')?.value) n++;
  return n;
}
function updateTxnFilterBadge() {
  const badge = document.getElementById('txn-filter-badge');
  if (!badge) return;
  const n = txnActiveFilterCount();
  badge.textContent = String(n);
  badge.classList.toggle('hidden', n === 0);
}

// Mobile: re-parent the category + month controls into a bottom sheet (changes
// apply live); a Clear-all resets everything. Controls move back on dismiss.
function openTxnFilterSheet() {
  if (!window.MoneyHabitsIOS) return;
  const controls = document.getElementById('txn-filter-controls');
  if (!controls) return;
  const home   = controls.parentElement;        // restore here on dismiss
  const anchor = controls.nextElementSibling;    // (before the Filter button)

  controls.classList.remove('hidden', 'md:flex', 'md:items-center', 'md:gap-3');
  controls.classList.add('flex', 'flex-col', 'gap-4');
  controls.querySelectorAll('select, input').forEach(el => el.classList.add('w-full'));

  const wrap = document.createElement('div');
  wrap.className = 'px-4 pb-4 flex flex-col gap-4';
  wrap.appendChild(controls);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'text-sm text-neutral-600 underline self-start';
  clear.textContent = 'Clear all';
  clear.addEventListener('click', () => {
    document.getElementById('txn-search').value = '';
    document.getElementById('txn-cat-filter').value = '';
    document.getElementById('txn-month-filter').value = '';
    txnDayRange = null;
    txnVisibleMonths = 3;
    updateTxnFilterBadge();
    renderTransactionsHeader();
    renderTransactions();
    MoneyHabitsIOS.closeBottomSheet();
  });
  wrap.appendChild(clear);

  MoneyHabitsIOS.openBottomSheet({
    title: 'Filter Transactions',
    content: wrap,
    onDismiss: () => {
      // Restore the controls to their inline home + classes.
      controls.classList.remove('flex', 'flex-col', 'gap-4');
      controls.classList.add('hidden', 'md:flex', 'md:items-center', 'md:gap-3');
      controls.querySelectorAll('select, input').forEach(el => el.classList.remove('w-full'));
      if (home) home.insertBefore(controls, anchor);
      updateTxnFilterBadge();
    },
  });
}

// ── Month / day label constants ──────────────────────────────────────────────
// MONTH_LABELS is the shared month-abbreviation table (drill-down cumulative +
// bubble + daily-strip axis labels). radial.js carries its own copy.
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_LABELS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── Transaction side panel ────────────────────────────────────────────────────
// Dormant: kept in place for a future "transaction detail" surface. The radial
// chart no longer opens this panel — clicks on radial nodes flow through
// setLensMonth + the in-page drill-down instead. openTxnPanel is unreferenced
// today; the close-button listener still runs (no-op when the panel is hidden).

let _txnPanelOpener = null;

function openTxnPanel(yearMonth, category) {
  const panel = document.getElementById('txn-panel');
  // Capture the element that had focus when the panel opened so we can
  // restore it on close.
  _txnPanelOpener = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : document.body;

  const [year, mon] = yearMonth.split('-');
  const monthName = MONTH_LABELS[parseInt(mon, 10) - 1];
  document.getElementById('txn-panel-title').textContent = category || 'All spending';
  document.getElementById('txn-panel-meta').textContent  = `${monthName} ${year}`;

  document.getElementById('txn-panel-color-dot').style.backgroundColor = token('color-accent-700');

  document.getElementById('txn-panel-tbody').innerHTML = '';
  document.getElementById('txn-panel-empty').classList.add('hidden');
  document.getElementById('txn-panel-callout').textContent = '—';
  document.getElementById('txn-panel-count').textContent = 'Loading…';
  document.getElementById('txn-panel-total').textContent = '';

  panel.classList.add('panel-open');
  // Move focus into the panel so keyboard users land on the close button as
  // soon as the slide-in finishes. setTimeout keeps focus from triggering
  // the layout transition's :focus-visible flash mid-animation.
  setTimeout(() => document.getElementById('txn-panel-close')?.focus(), 50);

  // Dormant code path — kept for a future "transaction detail" surface. Now
  // filters the cached transactions.json client-side (mirrors the live tab).
  fetchJsonCached('transactions.json').then(file => {
    const rows = (file.rows || []).filter(t =>
      t.date.slice(0, 7) === yearMonth && (!category || t.category === category)
    );
    populateTxnPanel({ rows });
  });
}

function populateTxnPanel(data) {
  const tbody = document.getElementById('txn-panel-tbody');
  const empty = document.getElementById('txn-panel-empty');
  tbody.innerHTML = '';

  if (!data.rows.length) {
    empty.classList.remove('hidden');
    document.getElementById('txn-panel-count').textContent = '0 transactions';
    return;
  }

  let total = 0;
  data.rows.forEach(row => {
    total += row.amount;
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-neutral-50 transition-colors';
    tr.innerHTML = `
      <td class="px-5 py-3 text-neutral-500 whitespace-nowrap text-xs">${row.date}</td>
      <td class="px-5 py-3 text-neutral-800 font-medium max-w-[180px] truncate">${escHtml(row.name)}</td>
      <td class="px-5 py-3 text-right text-neutral-800 font-medium whitespace-nowrap">${fmt(row.amount)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('txn-panel-callout').textContent = fmt(total);
  document.getElementById('txn-panel-count').textContent =
    `${data.rows.length} transaction${data.rows.length !== 1 ? 's' : ''}`;
  document.getElementById('txn-panel-total').textContent = fmt(total);
}

function closeTxnPanel() {
  document.getElementById('txn-panel').classList.remove('panel-open');
  // Restore keyboard focus to whatever opened the panel.
  if (_txnPanelOpener && document.contains(_txnPanelOpener)) {
    _txnPanelOpener.focus({ preventScroll: true });
  }
  _txnPanelOpener = null;
}

document.getElementById('txn-panel-close')?.addEventListener('click', closeTxnPanel);
// Escape closes the panel from anywhere when it's open.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const panel = document.getElementById('txn-panel');
  if (panel?.classList.contains('panel-open')) closeTxnPanel();
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── In-place persona switch ───────────────────────────────────────────────────
// Called by the profile switcher after setActivePersona(key) writes localStorage.
// Clears every cache + module-state var (any miss = stale data after switch),
// refreshes the profile triggers to the new persona, then re-renders the
// currently-active tab against the new persona's static JSON tree. activeTab
// stays put — the user remains on the tab they were on.
async function resetAndReload() {
  // 1. Clear infra caches: HTTP JSON, Chart.js instances, the mobile scroll
  // listener, any stranded tooltips.
  clearJsonCache();
  for (const id in _charts) _charts[id]?.destroy();
  for (const id in _charts) delete _charts[id];
  if (_largeTitleCleanup) { _largeTitleCleanup(); _largeTitleCleanup = null; }
  hideCustomTooltip(); hideCjsTip();

  // 2. Reset per-tab module state to v2 defaults.
  overviewInited = false; overviewSnapshot = null; overviewMonths = []; overviewOverlay = false;
  lensMonth = ''; lensCategory = ''; lensCompare = ''; lensTimeframe = 'last-12-months';
  lensLevel = 'all'; lensChartView = 'total';
  chartType = 'bar'; radialYears = new Set(); radialHighlightYear = null;
  ddPieMode = 'proportion'; _ddLastData = null; _ddLastColor = null;
  _radialDataCache = null; _radialDataKey = '';
  _catMeta = null; _catMetaPromise = null;
  habitsInited = false;
  catSelectedMonth = ''; catCompareMonth = ''; catAllMonths = [];
  catDetailCache = {}; catBubblePositions = []; catPrimaryBubbleDsIdx = 0;
  txnInited = false; _allTransactions = null; txnVisibleMonths = 3; txnDayRange = null;

  // 3. Refresh the profile-switcher's triggers + dropdown so the new persona
  // shows as active. (Listeners on the panel rows are re-attached too.)
  await _refreshProfilePanel();

  // 4. Re-render the currently-active tab against the new persona.
  if (activeTab === 'overview')          await initOverviewTab();
  else if (activeTab === 'habits')       await initDashboard();
  else if (activeTab === 'transactions') await renderTransactionsTab();
}

// Repaint the profile triggers + persona dropdown after a switch. Extracted so
// both initProfileSwitcher (first paint) and resetAndReload (re-paint) share it.
async function _refreshProfilePanel() {
  let datasets = [];
  try { datasets = await fetchPersonasJson(); } catch (e) { return; }
  const activeKey = getActivePersona();
  const active    = datasets.find(d => d.key === activeKey) || datasets[0];

  if (active) {
    const nameEl  = document.getElementById('profile-name');
    const badgeEl = document.getElementById('profile-badge');
    const mBadge  = document.getElementById('profile-badge-mobile')?.querySelector('span');
    if (nameEl)  nameEl.textContent  = active.label;
    if (badgeEl) badgeEl.textContent = _profileInitial(active.key);
    if (mBadge)  mBadge.textContent  = _profileInitial(active.key);
  }

  const panel = document.getElementById('profile-panel');
  if (!panel) return;
  panel.innerHTML = `<p class="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Dataset</p>`
    + datasets.map(d => {
        const isA = d.key === activeKey;
        return `<button type="button" data-key="${d.key}" class="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-neutral-50 focus:outline-none focus:bg-neutral-50">
          <span class="w-6 h-6 rounded-md bg-neutral-100 text-neutral-600 text-xs font-semibold flex items-center justify-center shrink-0" aria-hidden="true">${_profileInitial(d.key)}</span>
          <span class="flex-1 min-w-0 text-sm truncate ${isA?'font-semibold text-neutral-900':'text-neutral-700'}">${escHtml(d.label)}</span>
          ${isA?'<span class="text-accent-700 shrink-0" aria-label="active">✓</span>':''}
        </button>`;
      }).join('');
  panel.querySelectorAll('button[data-key]').forEach(item => {
    item.addEventListener('click', async () => {
      const key = item.dataset.key;
      if (key === getActivePersona()) { closeProfileMenu(); return; }
      setActivePersona(key);
      closeProfileMenu();
      await resetAndReload();
    });
  });
}

// ── Install banner (PWA A2HS) ─────────────────────────────────────────────────
// Surfaces on visit 2+ for users who haven't installed yet. iOS Safari can't
// trigger A2HS programmatically, so it gets a hint card pointing at Share →
// Add to Home Screen. Android Chrome fires `beforeinstallprompt` — we capture
// the event and surface a native Install button. Dismiss persists in
// localStorage so a stuck-with-the-X banner doesn't follow them forever.
const VISIT_COUNT_KEY       = 'mh-visit-count';
const INSTALL_DISMISSED_KEY = 'mh-install-dismissed';
let _deferredInstallPrompt = null;

function _isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
         window.navigator.standalone === true;
}
function _isIOSSafari() {
  const ua = navigator.userAgent || '';
  // iPadOS reports as Mac; treat any touch-capable Safari-ish UA as iOS too.
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  return isIOSDevice && /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS)/.test(ua);
}
function _installDismissed() {
  try { return localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true'; } catch (e) { return false; }
}
function _bumpVisitCount() {
  try {
    const n = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || '0', 10) + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(n));
    return n;
  } catch (e) { return 1; }
}
function dismissInstallBanner() {
  try { localStorage.setItem(INSTALL_DISMISSED_KEY, 'true'); } catch (e) {}
  document.getElementById('install-banner')?.remove();
}

// Pre-bind: Android Chrome fires beforeinstallprompt at any time, often before
// we evaluate the show-banner conditions. Capture it so we can call prompt()
// from the banner button later.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  maybeShowInstallBanner();
});

function maybeShowInstallBanner() {
  if (window.__CHART_PLAYGROUND__) return;
  if (_isStandalone() || _installDismissed()) return;
  const visits = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || '0', 10);
  if (visits < 2) return;                              // wait for the 2nd visit
  if (document.getElementById('install-banner')) return;

  if (_isIOSSafari())              _renderInstallBannerIOS();
  else if (_deferredInstallPrompt) _renderInstallBannerAndroid();
  // (Other browsers don't expose an install path — silently skip.)
}

function _buildInstallBannerShell() {
  const el = document.createElement('div');
  el.id = 'install-banner';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Install MoneyHabits');
  el.className = 'fixed left-4 right-4 md:left-auto md:right-6 md:max-w-sm bg-white border border-neutral-200 rounded-xl shadow-lg p-3 z-40';
  // Clear the mobile bottom tab bar (~64pt + safe area). On desktop the rail
  // is on the side, so a flat bottom margin works.
  el.style.bottom = 'calc(env(safe-area-inset-bottom) + 72px)';
  document.body.appendChild(el);
  return el;
}
const _INSTALL_X_SVG = '<svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/></svg>';
// iOS Share glyph — box with an arrow popping up out of it.
const _IOS_SHARE_SVG = '<svg class="inline-block w-3.5 h-3.5 align-text-bottom mx-0.5 text-accent-700" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5h1.5A1.5 1.5 0 0 1 14 6.5v6A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5H5"/><path d="M8 2v8"/><path d="M5.5 4.5L8 2l2.5 2.5"/></svg>';

function _renderInstallBannerIOS() {
  const el = _buildInstallBannerShell();
  el.innerHTML = `
    <div class="flex items-start gap-3">
      <img src="/static/icons/icon-180.png" alt="" class="w-10 h-10 rounded-lg shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-neutral-900">Install MoneyHabits</p>
        <p class="text-xs text-neutral-500 mt-0.5">Tap${_IOS_SHARE_SVG}then <strong class="text-neutral-700">Add to Home Screen</strong>.</p>
      </div>
      <button type="button" aria-label="Dismiss install prompt" class="-mr-1 -mt-1 p-2 text-neutral-400 hover:text-neutral-600 shrink-0" data-install-dismiss>${_INSTALL_X_SVG}</button>
    </div>`;
  el.querySelector('[data-install-dismiss]')?.addEventListener('click', dismissInstallBanner);
}

function _renderInstallBannerAndroid() {
  const el = _buildInstallBannerShell();
  el.innerHTML = `
    <div class="flex items-center gap-3">
      <img src="/static/icons/icon-180.png" alt="" class="w-10 h-10 rounded-lg shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold text-neutral-900">Install MoneyHabits</p>
        <p class="text-xs text-neutral-500 mt-0.5">Add it to your home screen for offline access.</p>
      </div>
      <button type="button" class="px-3 py-1.5 rounded-lg bg-accent-700 text-white text-xs font-semibold hover:bg-accent-800 focus:outline-none focus:ring-2 focus:ring-accent-700 shrink-0" data-install-prompt>Install</button>
      <button type="button" aria-label="Dismiss install prompt" class="-mr-1 -mt-1 p-2 text-neutral-400 hover:text-neutral-600 shrink-0" data-install-dismiss>${_INSTALL_X_SVG}</button>
    </div>`;
  el.querySelector('[data-install-prompt]')?.addEventListener('click', async () => {
    if (!_deferredInstallPrompt) return;
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    _deferredInstallPrompt = null;
    if (outcome === 'accepted') dismissInstallBanner();
  });
  el.querySelector('[data-install-dismiss]')?.addEventListener('click', dismissInstallBanner);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
// The chart playground skips the live-app boot — it drives render functions
// directly against static persona JSON.
if (!window.__CHART_PLAYGROUND__) {
  // Open the tab named in the URL hash (deep-link / refresh), else Overview.
  const initialTab = tabFromHash() || 'overview';
  history.replaceState({ tab: initialTab }, '', '#' + initialTab);
  showTab(initialTab, { updateHash: false });
  initProfileSwitcher();
  _bumpVisitCount();
  maybeShowInstallBanner();
}
