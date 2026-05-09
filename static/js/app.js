// ── Shared Plotly theme ───────────────────────────────────────────────────────
const PLOTLY_LAYOUT = {
  paper_bgcolor: '#ffffff',
  plot_bgcolor:  '#ffffff',
  font: { family: 'Inter, ui-sans-serif, system-ui, sans-serif', color: '#374151' },
  margin: { t: 10, r: 10, b: 40, l: 10 },
  colorway: ['#6366f1','#818cf8','#a5b4fc','#c7d2fe','#e0e7ff',
             '#f97316','#fb923c','#fca5a1','#34d399','#facc15'],
};

const PLOTLY_CONFIG = { displayModeBar: false, responsive: true };

function fmt(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Custom DOM tooltip (shared by every Plotly chart) ────────────────────────
// We disable Plotly's native hoverlabels (`hoverinfo: 'none'` per trace) and
// drive a single #ct-tip element via plotly_hover / plotly_unhover events.
// Per-chart `tip*HTML` builders produce the rich card content.
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
  const emoji = e ? `<span class="cat-emoji">${e}</span>` : '';
  return `${emoji}${escHtml(name)}`;
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

function showTab(name) {
  activeTab = name;
  // Close the Habits page-header chip dropdown on any tab change so leaving
  // Habits with the panel open doesn't leave it visible elsewhere.
  document.getElementById('hc-chip-panel')?.classList.add('hidden');
  if (name === 'overview')     setPageHeader("This Month's Snapshot", '');
  if (name === 'habits')       setHabitsPageHeader();
  if (name === 'transactions') setPageHeader('Transactions', transactionsSubtitle());
  ['overview', 'habits', 'transactions'].forEach(t => {
    const sec = document.getElementById('section-' + t);
    if (sec) sec.classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('bg-accent-100', active);
    btn.classList.toggle('text-accent-700', active);
    btn.classList.toggle('text-gray-600', !active);
    btn.classList.toggle('hover:bg-gray-100', !active);
  });
  if (name === 'overview')     initOverviewTab();
  if (name === 'habits' && !habitsInited) {
    habitsInited = true;
    initDashboard();
  }
  if (name === 'transactions') renderTransactionsTab();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});


// ── Dataset switcher (header) ────────────────────────────────────────────────
async function initDatasetSwitcher() {
  const btn   = document.getElementById('dataset-switcher-btn');
  const panel = document.getElementById('dataset-switcher-panel');
  const label = document.getElementById('dataset-switcher-label');
  if (!btn || !panel || !label) return;

  const datasets = await fetch('/api/datasets').then(r => r.json());
  const active = datasets.find(d => d.active) || datasets[0];
  if (!active) return;
  label.textContent = active.label;

  panel.innerHTML = datasets.map(d => `
    <button type="button" data-key="${d.key}"
      class="w-full text-left text-sm px-3 py-2 hover:bg-gray-50 flex items-center justify-between
             ${d.active ? 'text-accent-700 font-semibold' : 'text-gray-700'}">
      <span>${d.label}</span>
      ${d.active ? '<span class="text-accent-600">●</span>' : ''}
    </button>
  `).join('');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.toggle('hidden');
  });

  panel.querySelectorAll('button[data-key]').forEach(item => {
    item.addEventListener('click', async () => {
      const key = item.dataset.key;
      if (key === active.key) { panel.classList.add('hidden'); return; }
      const res = await fetch('/api/datasets/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.ok) window.location.reload();
    });
  });

  document.addEventListener('click', e => {
    if (!btn.contains(e.target) && !panel.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });
}

initDatasetSwitcher();


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

const OVERVIEW_DEFAULT_EXCLUDES = ['Rent'];

let overviewInited   = false;
let overviewSnapshot = null;

async function initOverviewTab() {
  if (overviewInited) return;
  overviewInited = true;

  let snap;
  try {
    [snap] = await Promise.all([
      fetch('/api/overview/snapshot').then(r => r.json()),
      loadCategoryMeta(),
    ]);
  } catch (e) {
    console.error('Overview snapshot fetch failed', e);
    return;
  }
  overviewSnapshot = snap;

  // Top categories for the active month, excluding default exclusions.
  let topCats = [];
  try {
    const params = new URLSearchParams({ year_month: snap.month });
    if (OVERVIEW_DEFAULT_EXCLUDES.length) params.set('exclude', OVERVIEW_DEFAULT_EXCLUDES.join(','));
    topCats = await fetch('/api/top-categories?' + params).then(r => r.json());
  } catch (e) { /* swallow — render empty */ }
  topCats = (topCats || []).slice(0, 3);

  renderOverviewHeader(snap);
  renderCard1(snap);
  renderCard2(snap);
  renderCard3(snap);
  renderCard4(topCats, snap.month);
  renderOverviewLineChart(snap);
  wireOverviewActions(snap);
}

function computeSmartMessage(snap) {
  // Need a real last-month MTD comparison anchor.
  if (snap.last_month_mtd == null || snap.last_month_mtd <= 0) return null;

  const dLm = (snap.this_month_total - snap.last_month_mtd) / snap.last_month_mtd;

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
    return `${pct}% ${dir} than your 3-month average`;
  }

  if (Math.abs(dLm) < 0.05) return 'On pace with last month';

  const pct = Math.round(Math.abs(dLm) * 100);
  const dir = dLm >= 0 ? 'more' : 'less';
  return `${pct}% ${dir} than last month`;
}

function renderOverviewHeader(snap) {
  if (!snap) return;
  const monthLabel = formatMonthLabel(snap.month);
  const subtitle = snap.is_fallback
    ? `Showing latest available month — ${monthLabel}`
    : monthLabel;
  setPageHeader("This Month's Snapshot", subtitle);
}

const OVERVIEW_INFO_ICON = `
  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"/>
  </svg>
`;

// Info-icon trigger + styled popover (.info-tt / .info-tt-bubble in style.css).
// Replaces native `title`-based tooltips so the cursor doesn't go question-mark
// and the bubble matches our visual language.
function infoTooltip(text) {
  return `<span class="info-tt shrink-0 text-gray-400" tabindex="0">${OVERVIEW_INFO_ICON}<span class="info-tt-bubble">${escHtml(text)}</span></span>`;
}

// Single ghost-button class composition used by all four card linkouts.
// Mirrors the existing chip/button style elsewhere in the codebase
// (compare chip, window picker, category chip).
function ghostButton(label, action) {
  return `
    <button type="button" data-overview-action="${action}"
      class="inline-flex items-center justify-center gap-1.5 w-full
             text-sm font-medium text-gray-700
             border border-gray-300 rounded-lg
             px-3.5 py-2
             bg-white shadow-sm
             hover:bg-gray-50 hover:border-gray-400
             focus:outline-none focus:ring-2 focus:ring-accent-500
             transition-colors">
      ${escHtml(label)}
      <span aria-hidden="true">&rarr;</span>
    </button>
  `;
}

// Card-level shared classes (constants so all four cards stay in lockstep).
const CARD_SHELL = 'bg-white border border-gray-200 rounded-lg p-6 h-full flex flex-col';
const CARD_LABEL = 'text-base font-semibold text-gray-900';
const CARD_VALUE = 'text-6xl font-semibold tracking-tight text-gray-900 mt-3 break-words';
const CARD_VALUE_MISS = 'text-6xl font-semibold tracking-tight text-gray-400 mt-3 cursor-help';

function renderCard1(snap) {
  const card = document.getElementById('overview-card1');
  if (!card) return;

  const message = computeSmartMessage(snap);
  const lastMonth = prevMonthOf(snap.month);

  let tooltip;
  if (snap.is_partial && snap.through_day) {
    tooltip = `Compares ${formatMonthLabel(snap.month)} 1–${snap.through_day} to ${formatMonthLabel(lastMonth)} 1–${snap.through_day}.`;
  } else {
    tooltip = `Compares ${formatMonthLabel(snap.month)} to ${formatMonthLabel(lastMonth)}.`;
  }

  const messageHtml = message
    ? `<p class="text-sm text-gray-600 mt-2 flex items-center gap-1.5">
        <span>${escHtml(message)}</span>
        ${infoTooltip(tooltip)}
      </p>`
    : '';

  card.innerHTML = `
    <div class="${CARD_SHELL}">
      <p class="${CARD_LABEL}">Spent so far this month</p>
      <p class="${CARD_VALUE}">${fmt(snap.this_month_total)}</p>
      ${messageHtml}
      <div class="mt-auto pt-6">${ghostButton('See transactions', 'tx-current')}</div>
    </div>
  `;
}

function renderCard2(snap) {
  const card = document.getElementById('overview-card2');
  if (!card) return;

  const has = snap.last_month_mtd != null;
  const valueHtml = has
    ? `<p class="${CARD_VALUE}">${fmt(snap.last_month_mtd)}</p>`
    : `<p class="${CARD_VALUE_MISS}" title="No prior month yet">—</p>`;
  const bottomHtml = has
    ? `<div class="mt-auto pt-6">${ghostButton('See transactions', 'tx-prev-partial')}</div>`
    : '';

  card.innerHTML = `
    <div class="${CARD_SHELL}">
      <p class="${CARD_LABEL}">Spent this time last month</p>
      ${valueHtml}
      ${bottomHtml}
    </div>
  `;
}

function renderCard3(snap) {
  const card = document.getElementById('overview-card3');
  if (!card) return;

  const has = snap.three_month_avg != null;
  const valueHtml = has
    ? `<p class="${CARD_VALUE}">${fmt(snap.three_month_avg)}</p>`
    : `<p class="${CARD_VALUE_MISS}" title="Need 3 prior months">—</p>`;
  const bottomHtml = has
    ? `<div class="mt-auto pt-6">${ghostButton('Open in Habits', 'habits-3mo')}</div>`
    : '';

  card.innerHTML = `
    <div class="${CARD_SHELL}">
      <p class="${CARD_LABEL} flex items-center gap-1.5">
        <span>3-month average</span>
        ${infoTooltip("Calculated from the last 3 complete months of spending.")}
      </p>
      ${valueHtml}
      ${bottomHtml}
    </div>
  `;
}

function renderCard4(topCats, month) {
  const el = document.getElementById('overview-card4');
  if (!el) return;

  const has = topCats && topCats.length > 0;
  const bodyHtml = has
    ? `<ul class="mt-3 space-y-2">${topCats.map(c =>
        `<li><span class="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full max-w-full truncate" style="${catChipStyle(c.category)}">${catLabelHtml(c.category)}</span></li>`
      ).join('')}</ul>`
    : `<p class="text-sm text-gray-400 mt-3">No categories yet</p>`;

  const bottomHtml = has
    ? `<div class="mt-auto pt-6">${ghostButton('Open in Habits', 'habits-month')}</div>`
    : '';

  el.innerHTML = `
    <div class="${CARD_SHELL}">
      <p class="${CARD_LABEL} flex items-center gap-1.5">
        <span>Top Categories this month</span>
        ${infoTooltip("Excludes fixed expenses like rent by default. Configurable in Habits.")}
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

function renderOverviewLineChart(snap) {
  hideCustomTooltip();
  const container = document.getElementById('overview-chart-card');
  if (!container) return;

  // Reset card markup each call (avoids accumulating Plotly chart elements)
  container.innerHTML = `
    <p class="text-lg font-semibold text-gray-900">${escHtml(formatMonthLabel(snap.month))}</p>
    <div id="overview-chart" class="w-full mt-3" style="height:380px"></div>
  `;

  const accentColor = token('color-accent-500');
  const greyColor   = token('color-gray-400');
  const gridColor   = token('color-gray-100');

  const traces = [];

  if (snap.this_cumulative && snap.this_cumulative.length) {
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: 'This month',
      x: snap.this_cumulative.map(d => d.day),
      y: snap.this_cumulative.map(d => d.total),
      line: { color: accentColor, width: 2 },
      fill: 'tozeroy',
      fillcolor: hexToRgba(accentColor, 0.08),
      hoverinfo: 'none',
    });
  }

  if (snap.last_cumulative && snap.last_cumulative.length) {
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: 'Last month',
      x: snap.last_cumulative.map(d => d.day),
      y: snap.last_cumulative.map(d => d.total),
      line: { color: greyColor, width: 2 },
      hoverinfo: 'none',
    });
  }

  const lastDayThis = (snap.this_cumulative && snap.this_cumulative.length)
    ? snap.this_cumulative[snap.this_cumulative.length - 1].day : 0;
  const lastDayLast = (snap.last_cumulative && snap.last_cumulative.length)
    ? snap.last_cumulative[snap.last_cumulative.length - 1].day : 0;
  const maxDays = Math.max(lastDayThis, lastDayLast, 28);

  Plotly.newPlot('overview-chart', traces, {
    ...PLOTLY_LAYOUT,
    xaxis: {
      range: [0.5, maxDays + 0.5],
      tickfont: { size: 11 },
      gridcolor: gridColor,
      title: { text: 'Day', font: { size: 11 }, standoff: 8 },
      dtick: 2,
    },
    yaxis: {
      tickformat: '$,.0f',
      tickfont: { size: 11 },
      gridcolor: gridColor,
      title: { text: 'Spend', font: { size: 11 } },
    },
    margin: { t: 20, r: 20, b: 50, l: 60 },
    showlegend: traces.length > 0,
    legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.12, font: { size: 11 } },
  }, PLOTLY_CONFIG);

  const ovChart = document.getElementById('overview-chart');
  ovChart?.on('plotly_hover',   evt => showCustomTooltip(tipOverviewCumulHTML(evt), evt.event));
  ovChart?.on('plotly_unhover', () => hideCustomTooltip());
}

// Overview cumulative tooltip — accent matches the active series ("This month"
// uses accent color, "Last month" is muted).
function tipOverviewCumulHTML(evt) {
  const pt = evt.points?.[0];
  if (!pt) return '';
  const isThis = pt.data?.name === 'This month';
  return tipCard({
    title: `Day ${pt.x}`,
    meta: pt.data?.name || '',
    value: isThis ? fmt(pt.y || 0) : `Last month: ${fmt(pt.y || 0)}`,
  });
}

// Navigation helpers — set window.moneyHabitsNav, then switch tabs. Other tabs
// read the nav state when they activate.

function goToTransactionsCurrent(snap) {
  window.moneyHabitsNav = { tab: 'transactions', year_month: snap.month };
  showTab('transactions');
}

function goToTransactionsPrevPartial(snap) {
  if (snap.last_month_mtd == null) return;
  const lastMonth = prevMonthOf(snap.month);
  window.moneyHabitsNav = {
    tab: 'transactions',
    year_month: lastMonth,
    start_day: 1,
    end_day:   snap.through_day,
  };
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

// Label suffix for the Avg KPI eyebrow per preset.
const KPI_AVG_LABEL = {
  'last-3-months':  '3-Mo Avg',
  'last-6-months':  '6-Mo Avg',
  'last-12-months': '12-Mo Avg',
  'ytd':            'YTD Avg',
  'all-time':       'Monthly Avg',
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
  buildDrillDownMonthPanel();
  setHabitsPageHeader();
  renderHabitsKpis();
  renderCategoryTree();
  renderHabitsChart();
  renderDrillDown();
}

// Setter for the focused month. Drives KPIs + drill-down only — chart and tree
// are scoped to lensTimeframe and don't need to re-render here.
function setLensMonth(m) {
  lensMonth = m;
  catSelectedMonth = m;
  catDetailCache = {};
  buildDrillDownMonthPanel();
  setHabitsPageHeader();
  renderHabitsKpis();
  renderDrillDown();
}

function scrollToDrilldown() {
  document.getElementById('habits-drilldown')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const name  = lensLevel === 'all' ? 'All Spending' : (lensCategory || 'Habits');
  const slug  = lensLevel === 'all' ? 'default'      : catSlug(name);
  const emoji = lensLevel === 'all' ? '📊'           : catEmoji(name);

  // Pill-style chip: bg + fg use the category's chip tokens (matching the
  // dropdown items); --cat-mid drives the thick bottom border (data viz hue).
  // When the category has no emoji, skip the wrapper entirely so its margin
  // / flex-gap doesn't push the chip onto a new line.
  const emojiHtml = emoji ? `<span class="cat-emoji">${emoji}</span>` : '';
  titleEl.innerHTML = `Your Habits for <button id="hc-chip-btn" type="button"`
    + ` class="hc-chip hc-chip-underline inline-flex items-baseline gap-1 cursor-pointer hover:opacity-80 align-middle ml-1 rounded-lg px-3 py-1"`
    + ` style="--cat-mid: var(--color-cat-${slug}-mid);`
    + ` background-color: var(--color-cat-${slug}-bg);`
    + ` color: var(--color-cat-${slug}-fg);">`
    + `${emojiHtml}${escHtml(name)}`
    + `</button>`;

  subEl.innerHTML = '&nbsp;';

  // Anchor the dropdown panel under the chip's left edge (offset within the
  // shared `relative` wrapper around the H1).
  const chipBtn = document.getElementById('hc-chip-btn');
  const panel   = document.getElementById('hc-chip-panel');
  if (chipBtn && panel) {
    panel.style.left = chipBtn.offsetLeft + 'px';
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
  renderHabitsChart();
  renderDrillDown();
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
  updateBreadcrumbs();
  updateViewToggleUI();
  setHabitsPageHeader();
  renderHabitsKpis();
  renderCategoryTree();
  renderHabitsChart();
  renderDrillDown();
}

function setScopeAll()           { setLensScope({ level: 'all',    category: '' }); }
function setScopeParent(name)    { setLensScope({ level: 'parent', category: name }); }
function setScopeLeaf(name)      { setLensScope({ level: 'leaf',   category: name }); }

function setLensChartView(v) {
  lensChartView = v;
  updateViewToggleUI();
  renderHabitsChart();
  renderDrillDown();
}

// Sync the compare-select to the current lensCompare. (Was the last surviving job
// of the now-deleted updateFilterBar — month picker and category pill are gone.)
function syncCompareSelect() {
  const compareSel = document.getElementById('cat-compare-sel');
  if (compareSel && compareSel.value !== lensCompare) compareSel.value = lensCompare;
}

function updateBreadcrumbs() {
  const el = document.getElementById('habits-breadcrumbs');
  if (!el) return;
  el.innerHTML = '';

  const crumb = (label, onClick, isLast) => {
    if (isLast) {
      const span = document.createElement('span');
      span.className = 'text-gray-700';
      span.textContent = label;
      return span;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hover:text-accent-600 transition-colors';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  };

  const sep = () => {
    const s = document.createElement('span');
    s.className = 'text-gray-300 mx-1';
    s.textContent = '›';
    return s;
  };

  if (lensLevel === 'all') {
    el.appendChild(crumb('All Spending', null, true));
    return;
  }

  el.appendChild(crumb('All Spending', () => setScopeAll(), false));
  el.appendChild(sep());

  if (lensLevel === 'parent') {
    el.appendChild(crumb(lensCategory, null, true));
    return;
  }

  // leaf: insert parent crumb (if known) between root and leaf
  const meta = _catMeta?.find(r => r.category === lensCategory);
  const parent = meta?.parent || null;
  if (parent) {
    el.appendChild(crumb(parent, () => setScopeParent(parent), false));
    el.appendChild(sep());
  }
  el.appendChild(crumb(lensCategory, null, true));
}

function updateViewToggleUI() {
  const toggle = document.getElementById('habits-view-toggle');
  if (!toggle) return;
  // Toggle is meaningful at scope=all (toggle parent-stacked composition) and
  // scope=parent (toggle children-stacked composition vs parent total). Greyed
  // out at scope=leaf — nothing to stack inside a single leaf.
  const usable = lensLevel === 'all' || lensLevel === 'parent';
  toggle.classList.toggle('opacity-40', !usable);
  toggle.classList.toggle('pointer-events-none', !usable);
  toggle.querySelectorAll('.habits-view-btn').forEach(btn => {
    const active = btn.dataset.view === lensChartView;
    btn.classList.toggle('bg-accent-50',    active);
    btn.classList.toggle('text-accent-700', active);
    btn.classList.toggle('text-gray-500',  !active);
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
const S1_COMPARE_COLOR = '#94a3b8';   // muted slate for the compare-line overlay

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
  // Ramp lightness across ±20% of base, biased so idx=0 is darker than base.
  const span = 0.20;
  const minL = Math.max(0.18, l - span);
  const maxL = Math.min(0.86, l + span);
  const t = idx / (count - 1);                 // 0 → 1
  const lOut = minL + (maxL - minL) * t;
  return hslToHex({ h, s, l: lOut });
}

async function initDashboard() {
  const [allMonths, _meta] = await Promise.all([
    fetch('/api/months/list').then(r => r.json()),
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

  // Chart range picker (quick ranges only, lives in chart card header).
  const winBtn   = document.getElementById('s1-window-btn');
  const winPanel = document.getElementById('s1-window-panel');
  if (winBtn && winPanel) {
    winBtn.addEventListener('click', e => { e.stopPropagation(); winPanel.classList.toggle('hidden'); });
    document.addEventListener('click', e => {
      if (!winBtn.contains(e.target) && !winPanel.contains(e.target)) {
        winPanel.classList.add('hidden');
      }
    });
  }

  // Inject drill-down skeleton.
  buildCategoriesTabUI();

  // Drill-down month chip (lives in the drill-down section header).
  const ddBtn   = document.getElementById('dd-month-btn');
  const ddPanel = document.getElementById('dd-month-panel');
  if (ddBtn && ddPanel) {
    ddBtn.addEventListener('click', e => { e.stopPropagation(); ddPanel.classList.toggle('hidden'); });
    document.addEventListener('click', e => {
      if (!ddBtn.contains(e.target) && !ddPanel.contains(e.target)) {
        ddPanel.classList.add('hidden');
      }
    });
  }

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
  buildDrillDownMonthPanel();
  updateBreadcrumbs();
  updateViewToggleUI();
  setHabitsPageHeader();

  await Promise.all([
    renderHabitsKpis(),
    renderCategoryTree(),
    renderHabitsChart(),
    renderDrillDown(),
  ]);
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
    b.className = ['block w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50',
                   isActive ? 'bg-accent-50 text-accent-700 font-semibold' : ''].join(' ');
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

// Drill-down month chip — independent of the chart's range. Lists every month
// in the dataset newest first and highlights the currently focused month.
function buildDrillDownMonthPanel() {
  const panel = document.getElementById('dd-month-panel');
  if (!panel) return;
  panel.innerHTML = '';

  catAllMonths.slice().reverse().forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    const isActive = m === lensMonth;
    b.className = ['block w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50 whitespace-nowrap',
                   isActive ? 'bg-accent-50 text-accent-700 font-semibold' : ''].join(' ');
    b.textContent = formatMonthLabel(m);
    b.addEventListener('click', () => {
      panel.classList.add('hidden');
      setLensMonth(m);
    });
    panel.appendChild(b);
  });

  const lbl = document.getElementById('dd-month-label');
  if (lbl) lbl.textContent = lensMonth ? formatMonthLabel(lensMonth) : '—';
}

// ── Filter-aware KPI strip ────────────────────────────────────────────────────
const KPI_TOP_VALUE_FULL = ['text-2xl', 'font-semibold', 'text-gray-900', 'mt-1', 'truncate'];
const KPI_TOP_VALUE_EMPTY = ['text-sm', 'text-gray-400', 'mt-1', 'truncate'];

async function renderHabitsKpis() {
  const params = new URLSearchParams({ level: lensLevel });
  if (lensCategory) params.set('category', lensCategory);
  // Pivot "this_month" / "last_month" / "top" around the focused month.
  if (lensMonth) params.set('year_month', lensMonth);
  // Avg averages over the chart's range so the KPI scales with the trend chart.
  const { start: avgStart, end: avgEnd } = dateRangeFor(lensTimeframe);
  if (avgStart) params.set('avg_start', avgStart);
  if (avgEnd)   params.set('avg_end',   avgEnd);
  const data = await fetch('/api/summary?' + params).then(r => r.json());

  document.getElementById('kpi-this-month').textContent = fmt(data.this_month || 0);
  document.getElementById('kpi-last-month').textContent  = fmt(data.last_month || 0);
  document.getElementById('kpi-avg').textContent         = fmt(data.monthly_avg || 0);

  // Dynamic eyebrow labels — always absolute month references reflecting the
  // focused month, with the Avg label flipping to match the chart's range.
  const activeMonth = lensMonth;
  const priorMonth  = prevMonthStr(activeMonth);
  const monthLabel  = formatMonthLabel(activeMonth);   // "May 2026"
  const priorLabel  = formatMonthLabel(priorMonth);    // "Apr 2026"

  const thisEyebrow  = document.getElementById('kpi-this-month-label');
  const lastEyebrow  = document.getElementById('kpi-last-month-label');
  const avgEyebrow   = document.getElementById('kpi-avg-label');
  if (thisEyebrow) thisEyebrow.textContent = monthLabel;
  if (lastEyebrow) lastEyebrow.textContent = priorLabel;
  if (avgEyebrow)  avgEyebrow.textContent  = KPI_AVG_LABEL[lensTimeframe] || 'Monthly Avg';

  // Top X value: when empty (no data this month for the active scope), show a
  // muted "No data this month" placeholder instead of a heavy em dash.
  const topEl = document.getElementById('kpi-top-cat');
  const rawLabel = data?.top?.label;
  const isEmpty = !rawLabel || rawLabel === '—';
  topEl.classList.remove(...KPI_TOP_VALUE_FULL, ...KPI_TOP_VALUE_EMPTY);
  if (isEmpty) {
    topEl.textContent = 'No data this month';
    topEl.classList.add(...KPI_TOP_VALUE_EMPTY);
  } else {
    topEl.textContent = rawLabel;
    topEl.classList.add(...KPI_TOP_VALUE_FULL);
  }

  const labelEl = document.getElementById('kpi-top-cat-label');
  if (labelEl) {
    const base = {
      parent:   'Top Category',
      leaf:     'Top Category',   // (was 'Top Child' — never use 'Child' in user copy)
      merchant: 'Top Merchant',
    }[data?.top?.level] || 'Top Category';
    labelEl.textContent = `${base} ${monthLabel}`;
  }
}

// ── Hierarchical category tree (left rail) ────────────────────────────────────
async function renderCategoryTree() {
  const list = document.getElementById('hc-cat-panel-list');
  if (!list) return;
  // The tree is a navigation device — its totals reflect the full active
  // timeframe (e.g. YTD shows YTD totals), not just the focus month.
  const params = new URLSearchParams();
  const { start, end } = dateRangeFor(lensTimeframe);
  if (start) params.set('start', start);
  if (end)   params.set('end', end);
  const data = await fetch('/api/category-hierarchy?' + params).then(r => r.json());

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
    isActive ? 'bg-accent-50 text-accent-700 ring-1 ring-accent-200' : 'hover:bg-gray-50 text-gray-700',
  ].join(' ');
  btn.style.paddingLeft = (12 + indent * 16) + 'px';

  if (level === 'all') {
    btn.innerHTML = `
      <span class="font-semibold flex-1 truncate">All Spending</span>
      <span class="text-xs tabular-nums text-gray-500">${fmt(total)}</span>
    `;
  } else {
    btn.innerHTML = `
      <span class="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full max-w-full truncate" style="${catChipStyle(name)}">${catLabelHtml(name)}</span>
      <span class="text-xs tabular-nums text-gray-500 ml-auto">${fmt(total)}</span>
    `;
  }
  btn.addEventListener('click', onClick);
  return btn;
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

  const hoverFmt = granularity === 'month' ? '%b %Y' : '%b %-d, %Y';

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

  const primary = await fetch('/api/monthly' + buildQuery(start, end, queryOpts)).then(r => r.json());
  const periods = primary.map(d => d.period);

  const traces = [];

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

      traces.push({
        type: 'bar',
        x: periods,
        y: primary.map(row => row.totals?.[key] || 0),
        marker: { color, line: { color: '#ffffff', width: 0.5 } },
        name: key,
        hoverinfo: 'none',
      });
    });
  } else {
    // Single-trace bar (total, leaf, or all-with-no-stack).
    // 'all' scope is the canonical view → brand indigo (accent-500). Leaf/parent use their own hue.
    const totals = primary.map(d => d.total);
    const traceColor = lensLevel === 'leaf'   ? catHex(lensCategory, 'mid')
                     : lensLevel === 'parent' ? catHex(lensCategory, 'mid')
                     :                          token('color-accent-500');
    traces.push({
      type: 'bar',
      x: periods,
      y: totals,
      marker: { color: traceColor },
      hoverinfo: 'none',
      name: lensLevel === 'all' ? 'All Spending' : lensCategory,
    });
  }

  // Compare overlay (skipped in stacked mode by setLensCompare invariant).
  // Chart is always monthly, so we shift the window by `periods.length` months
  // ending at lensCompare.
  if (lensCompare && mode === 'single') {
    const compareQuery = (() => {
      const [cy, cm] = lensCompare.split('-').map(Number);
      const cmpEnd   = new Date(cy, cm, 0);
      const cmpStart = new Date(cy, cm - periods.length, 1);
      const fmtD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return buildQuery(fmtD(cmpStart), fmtD(cmpEnd), queryOpts);
    })();

    const compare = await fetch('/api/monthly' + compareQuery).then(r => r.json());
    const compareTotals = compare.map(d => d.total || 0);
    while (compareTotals.length < periods.length) compareTotals.push(0);
    traces.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: periods,
      y: compareTotals.slice(0, periods.length),
      line:   { color: S1_COMPARE_COLOR, width: 2, dash: 'dash' },
      marker: { color: S1_COMPARE_COLOR, size: 5 },
      name: `vs ${formatMonthLabel(lensCompare)}`,
      hoverinfo: 'none',
    });
  }

  // Pre-compute tick labels — Plotly's tickformat is ignored on categorical axes.
  const ticktext = periods.map((p, i) => formatPeriodTick(p, granularity, i, periods.length));

  Plotly.newPlot('chart-monthly', traces, {
    ...PLOTLY_LAYOUT,
    barmode: mode === 'stacked' ? 'stack' : 'group',
    xaxis: {
      type: 'category',
      tickfont: { size: 11 },
      tickmode: 'array',
      tickvals: periods,
      ticktext: ticktext,
      tickangle: 0,
    },
    yaxis: { tickformat: '$,.0f', tickfont: { size: 11 }, gridcolor: '#f3f4f6' },
    bargap: 0.3,
    showlegend: mode === 'stacked' || !!lensCompare,
    // Anchor the legend's bottom just above the plot. With more than ~5 entries
    // the legend wraps to multiple rows; yanchor:'bottom' makes additional rows
    // grow upward into the top margin instead of down into the chart.
    legend: { orientation: 'h', x: 1, xanchor: 'right', y: 1.02, yanchor: 'bottom', font: { size: 11 } },
    margin: { t: 80, r: 10, b: 50, l: 60 },
  }, PLOTLY_CONFIG);

  // Click handlers:
  // - Stacked-by-parent (level=all): segment click → drill into that parent (chart re-renders).
  // - Otherwise: bar click → set the focused month + smooth-scroll to drill-down.
  //   The chart itself does NOT re-render — only KPIs and drill-down update.
  const chartEl = document.getElementById('chart-monthly');
  chartEl.on('plotly_click', evt => {
    const pt = evt.points[0];
    if (mode === 'stacked' && lensLevel === 'all') {
      const parentName = pt.data?.name;
      if (parentName && parentName !== 'Other') {
        setScopeParent(parentName);
        return;
      }
    }
    const raw = pt.x;
    let monthKey = '';
    if (typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw)) {
      monthKey = raw;
    } else {
      const d = new Date(raw);
      if (!isNaN(d)) monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    if (monthKey) {
      setLensMonth(monthKey);
      scrollToDrilldown();
    }
  });

  // Custom tooltip wiring — uses `mode` and `primary` from this render's closure.
  chartEl.on('plotly_hover',   evt => showCustomTooltip(tipBarHTML(evt, mode, primary), evt.event));
  chartEl.on('plotly_unhover', () => hideCustomTooltip());
}

// Build the bar-chart tooltip HTML. mode = 'single' | 'stacked'; primary is
// the /api/monthly response (used to compute % of period total in stacked mode).
function tipBarHTML(evt, mode, primary) {
  const pt = evt.points?.[0];
  if (!pt) return '';
  const xRaw = pt.x;
  const monthKey = typeof xRaw === 'string' && /^\d{4}-\d{2}$/.test(xRaw)
    ? xRaw
    : (() => { const d = new Date(xRaw); return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })();
  const monthLabel = monthKey ? formatMonthLabel(monthKey) : '';
  const value = fmt(pt.y || 0);

  // Compare overlay (scatter trace).
  if (pt.data?.type === 'scatter') {
    return tipCard({
      title: `vs ${formatMonthLabel(lensCompare)}`,
      meta: monthLabel,
      value,
    });
  }

  // Stacked bar — show parent (or child) emoji + name + % of period total.
  if (mode === 'stacked') {
    const segName = pt.data?.name || '';
    const row = primary.find(r => r.period === pt.x);
    const periodTotal = row ? Object.values(row.totals || {}).reduce((a, b) => a + (b || 0), 0) : 0;
    const pct = periodTotal > 0 ? Math.round((pt.y / periodTotal) * 100) : 0;
    const isOther = segName === 'Other';
    const accentSlug = isOther ? 'default' : (segName ? catSlug(segName) : '');
    return tipCard({
      accentSlug,
      title: segName ? (isOther ? escHtml(segName) : tipCatBadge(segName)) : '',
      meta: monthLabel,
      value,
      rows: periodTotal > 0 ? [{ lbl: 'of month', val: pct + '%' }] : [],
    });
  }

  // Single-trace bar — accent matches the active scope's hue.
  const accentSlug = lensLevel === 'all' ? '' : catSlug(lensCategory);
  const titleHtml  = lensLevel === 'all' ? 'All Spending' : tipCatBadge(lensCategory);
  return tipCard({ accentSlug, title: titleHtml, meta: monthLabel, value });
}


function formatMonthLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || '';
  const [y, m] = ym.split('-');
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Tick label for an x-axis period. Plotly's `tickformat` is ignored when
// xaxis.type === 'category' (the case for monthly bar charts), so we compute
// explicit ticktext via this helper and pass it via xaxis.tickvals/ticktext.
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

// ── Categories (Category Spending) ────────────────────────────────────────────

// Category → CSS-variable slug. Hex values live in static/css/style.css :root
// as --color-cat-{slug}-{bg|fg|mid}. Children inherit their parent's slug
// via /api/category-meta + catSlug() below.
const PARENT_SLUG = {
  'Food & Drink':    'food',
  'Personal Care':   'personal',
  'Car & Transport': 'car',
  'Shopping':        'shopping',
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
  return e ? `<span class="cat-emoji">${e}</span>${escHtml(catNorm)}` : escHtml(catNorm);
}

let _catMeta = null;
let _catMetaPromise = null;
function loadCategoryMeta() {
  if (!_catMetaPromise) {
    _catMetaPromise = fetch('/api/category-meta')
      .then(r => r.json())
      .then(rows => { _catMeta = rows; return rows; });
  }
  return _catMetaPromise;
}

function catSlug(catNorm) {
  if (!catNorm || catNorm === 'Uncategorized') return 'default';
  if (PARENT_SLUG[catNorm]) return PARENT_SLUG[catNorm];
  if (ORPHAN_SLUG[catNorm]) return ORPHAN_SLUG[catNorm];
  const parent = _catMeta?.find(r => r.category === catNorm)?.parent;
  if (parent && PARENT_SLUG[parent]) return PARENT_SLUG[parent];
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
let catPrimaryBubbleTraceIdx = 0;   // trace index of primary (colored) bubbles

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
    <div id="dd-inner" class="bg-neutral-50 border border-neutral-200 rounded-lg p-6 flex flex-col gap-6" style="box-shadow:0 20px 25px -5px rgba(0,0,0,0.1),0 10px 10px -5px rgba(0,0,0,0.04)">

      <!-- Header -->
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <span id="dd-color-dot" class="w-10 h-10 rounded-full flex-none inline-flex items-center justify-center text-xl"></span>
          <h3 id="dd-cat-name" class="font-bold text-2xl text-gray-500 truncate"></h3>
        </div>

        <!-- Focused-month picker — drives KPIs + drill-down only -->
        <div class="relative shrink-0" id="dd-month-dropdown">
          <button id="dd-month-btn" type="button"
            class="flex items-center gap-2 text-sm font-semibold text-gray-700 border border-gray-300 rounded-lg px-3 py-2 bg-white shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-accent-500">
            <span id="dd-month-label">—</span>
            <svg class="w-3.5 h-3.5 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"/>
            </svg>
          </button>
          <div id="dd-month-panel"
            class="hidden absolute right-0 z-20 mt-1 min-w-[12rem] bg-white border border-gray-200 rounded-xl shadow-lg py-1 max-h-80 overflow-y-auto"></div>
        </div>
      </div>

      <!-- Row 1: 5-col grid — pie (2 cols) | quick stats (3 cols) -->
      <div class="grid grid-cols-5 gap-6">
        <!-- Pie card: col 1-2 -->
        <div class="col-span-2 bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex flex-col">
          <div class="px-6 pt-6 pb-3 shrink-0 flex items-start justify-between gap-3">
            <p id="dd-pie-title" class="font-semibold text-xl text-gray-900 leading-snug min-w-0"></p>
            <div id="dd-pie-mode-toggle" class="hidden rounded-lg border border-gray-300 overflow-hidden text-xs shadow-sm shrink-0">
              <button data-pie-mode="proportion"  type="button"
                class="dd-pie-mode-btn px-3 py-1.5 font-semibold bg-accent-50 text-accent-700">Proportion</button>
              <button data-pie-mode="composition" type="button"
                class="dd-pie-mode-btn px-3 py-1.5 font-semibold text-gray-500 hover:bg-gray-50">Composition</button>
            </div>
          </div>
          <div class="flex-1 px-6 pb-4">
            <div id="dd-pie" class="w-full" style="height:200px"></div>
          </div>
        </div>

        <!-- Quick stats: col 3-5, stacked vertically -->
        <div id="dd-quick-stats" class="col-span-3 flex flex-col gap-4 self-stretch"></div>
      </div>

      <!-- Row 2: 5-col grid — cumulative chart (3 cols) | top locations (2 cols) -->
      <div class="grid grid-cols-5 gap-5">
        <!-- Cumulative chart: col 1-3 -->
        <div class="col-span-3 bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
          <div class="px-6 pt-6 pb-0 flex items-center justify-between shrink-0">
            <p id="dd-cumul-title" class="font-semibold text-xl text-gray-900"></p>
            <p id="dd-compare-legend" class="hidden text-xs text-gray-400 italic"></p>
          </div>
          <div class="flex-1 px-6 pb-6 pt-3">
            <div id="dd-cumulative" class="w-full" style="height:160px"></div>
          </div>
        </div>

        <!-- Top locations: col 4-5 (title swaps by scope: Top Categories for all/parent, Top Locations for leaf) -->
        <div class="col-span-2 bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
          <div class="px-6 pt-6 pb-0 shrink-0">
            <p id="dd-locations-title" class="font-semibold text-xl text-gray-900">Top Locations</p>
          </div>
          <div class="px-6 pt-4 pb-6">
            <div id="dd-locations" class="flex flex-col gap-3.5"></div>
          </div>
        </div>
      </div>

      <!-- Row 3: full-width bubble chart -->
      <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div class="px-6 pt-6 pb-0 flex items-center justify-between">
          <p id="dd-bubble-title" class="font-semibold text-xl text-gray-900"></p>
          <div id="dd-bubble-legend" class="hidden flex items-center gap-4 text-xs text-gray-500"></div>
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

  const params = new URLSearchParams({ level: lensLevel, year_month: lensMonth });
  if (lensCategory) params.set('category', lensCategory);

  // Cache key includes scope so parent vs leaf detail don't collide.
  const key = `${lensLevel}||${lensCategory}||${lensMonth}`;
  if (!catDetailCache[key]) {
    catDetailCache[key] = await fetch('/api/category-detail?' + params).then(r => r.json());
  }
  const data = catDetailCache[key];

  let compareData = null;
  if (lensCompare && lensChartView !== 'stacked' && lensCompare !== lensMonth) {
    const cParams = new URLSearchParams({ level: lensLevel, year_month: lensCompare });
    if (lensCategory) cParams.set('category', lensCategory);
    const cKey = `${lensLevel}||${lensCategory}||${lensCompare}`;
    if (!catDetailCache[cKey]) {
      try {
        catDetailCache[cKey] = await fetch('/api/category-detail?' + cParams).then(r => r.json());
      } catch (e) { catDetailCache[cKey] = null; }
    }
    compareData = catDetailCache[cKey];
  }

  renderDrillDownView(data, compareData);
}

function renderDrillDownView(data, compareData) {
  if (!data) return;

  const monthLabel = formatMonthLabel(data.year_month);
  const level = data.level || 'leaf';
  const headerName = data.category;

  // Header dot + name. For 'all' scope, use a neutral default chip.
  const headerDot = document.getElementById('dd-color-dot');
  if (headerDot) {
    if (level === 'all') {
      headerDot.setAttribute('style', `background-color:var(--color-cat-default-bg);color:var(--color-cat-default-fg);`);
      headerDot.innerHTML = `<span class="cat-emoji" style="margin-right:0">📊</span>`;
    } else {
      headerDot.setAttribute('style', catChipStyle(headerName));
      headerDot.innerHTML = `<span class="cat-emoji" style="margin-right:0">${catEmoji(headerName)}</span>`;
    }
  }
  document.getElementById('dd-cat-name').textContent = headerName;

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
  // 'all' scope drives the cumulative line + bubble color in brand indigo (accent-500).
  const color = level === 'all' ? token('color-accent-500') : catHex(headerName);

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

  // Empty-data placeholder for non-all scopes — Plotly draws an empty hole
  // otherwise, which reads as a bug.
  if (level !== 'all' && (data.total || 0) === 0) {
    if (titleEl) titleEl.textContent = `${data.category} — ${monthLabel}`;
    if (pieEl) {
      Plotly.purge('dd-pie');
      pieEl.innerHTML = `<div class="h-full w-full flex items-center justify-center text-sm text-gray-400">No spending in ${monthLabel}</div>`;
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

  // Restore canvas if a previous render swapped in a placeholder.
  if (pieEl && !pieEl.querySelector('.plotly')) pieEl.innerHTML = '';

  // Compositional views label every slice and act as a navigation surface.
  // Proportion mode + leaf scope keep clean (no labels, no click drill).
  const isComposition = (level === 'all') || (level === 'parent' && effectiveMode === 'composition');

  Plotly.newPlot('dd-pie', [{
    type: 'pie',
    values,
    labels,
    hole: 0.6,
    textinfo: isComposition ? 'label+percent' : 'none',
    textposition: 'inside',
    insidetextorientation: 'horizontal',
    textfont: { size: 11 },
    hoverinfo: 'none',
    marker: { colors },
    showlegend: false,
  }], {
    ...PLOTLY_LAYOUT,
    margin: { t: 0, r: 0, b: 0, l: 0 },
    paper_bgcolor: 'transparent',
    plot_bgcolor:  'transparent',
  }, PLOTLY_CONFIG);

  // Click-to-drill on compositional pies: parent slices → drill into parent;
  // child slices → drill into leaf. "Other" rollup at all-scope is a no-op
  // (synthetic top-N rollup, not a real category).
  pieEl?.on('plotly_click', evt => {
    if (!isComposition) return;
    const sliceLabel = evt.points?.[0]?.label;
    if (!sliceLabel) return;
    if (level === 'all') {
      if (sliceLabel === 'Other') return;
      setScopeParent(sliceLabel);
    } else if (level === 'parent') {
      setScopeLeaf(sliceLabel);
    }
  });

  // Custom tooltip wiring.
  pieEl?.on('plotly_hover',   evt => showCustomTooltip(tipPieHTML(evt), evt.event));
  pieEl?.on('plotly_unhover', () => hideCustomTooltip());
}

// Pie tooltip — handles compositional ("Other"/named slice) and proportion
// ("Rest of month") cases. Plotly emits `pt.percent` as 0..1.
function tipPieHTML(evt) {
  const pt = evt.points?.[0];
  if (!pt) return '';
  const sliceLabel = pt.label || '';
  const value = fmt(pt.value || 0);
  const pct = Math.round(((pt.percent || 0) * 100));
  const rows = [{ lbl: 'of total', val: pct + '%' }];

  if (sliceLabel === 'Rest of month') {
    return tipCard({ title: 'Rest of month', value, rows });
  }
  if (sliceLabel === 'Other') {
    return tipCard({ accentSlug: 'default', title: 'Other', value, rows });
  }
  return tipCard({
    accentSlug: catSlug(sliceLabel),
    title: tipCatBadge(sliceLabel),
    value,
    rows,
  });
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
    btn.classList.toggle('bg-accent-50',     isActive);
    btn.classList.toggle('text-accent-700',  isActive);
    btn.classList.toggle('text-gray-500',    !isActive);
    btn.classList.toggle('hover:bg-gray-50', !isActive);
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

  stats.forEach(stat => {
    const card = document.createElement('div');
    // flex-1 so all three rows share equal height within the col-span-3 column
    card.className = 'flex-1 bg-white rounded-lg border border-gray-200 shadow-sm flex items-center gap-5 px-5 py-4';

    let badgeHtml = '';
    let subHtml   = '';

    if (stat.prev !== null && typeof stat.value === 'number' && stat.prev > 0) {
      const pctChange = ((stat.value - stat.prev) / stat.prev) * 100;
      const up = pctChange > 0;
      const sign = up ? '+' : '';
      const badgeColor = up ? 'text-rose-600 bg-rose-50' : 'text-emerald-600 bg-emerald-50';
      const arrow = up ? '↑' : '↓';
      badgeHtml = `<span class="inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${badgeColor}">${arrow} ${sign}${Math.abs(pctChange).toFixed(0)}%</span>`;
      const compareLabel = catCompareMonth ? formatMonthLabel(catCompareMonth) : 'prev';
      subHtml = `<p class="text-xs text-gray-400 mt-0.5">vs ${escHtml(stat.fmtFn(stat.prev))} (${compareLabel})</p>`;
    }

    const descHtml = stat.desc
      ? `<p class="text-xs text-gray-400 mt-0.5">${escHtml(stat.desc)}</p>`
      : '';

    card.innerHTML = `
      <p class="font-sans font-bold text-3xl text-gray-900 tabular-nums tracking-tight shrink-0">${escHtml(String(stat.fmtFn(stat.value)))}</p>
      <div class="flex flex-col min-w-0">
        <p class="text-sm font-semibold text-gray-500">${stat.label}</p>
        ${descHtml}
        ${badgeHtml}
        ${subHtml}
      </div>
    `;
    container.appendChild(card);
  });
}

function renderDdLocations(locations, color, level = 'leaf') {
  const container = document.getElementById('dd-locations');
  container.innerHTML = '';
  if (!locations || !locations.length) {
    container.innerHTML = '<p class="text-xs text-gray-400">No data</p>';
    return;
  }
  // For category-level rows (parent → children, all → parents) show colored chips;
  // for merchant rows (leaf scope) keep the simple text+amount layout.
  const showChip = level === 'parent' || level === 'all';
  locations.forEach(loc => {
    const el = document.createElement('div');
    el.className = 'flex items-center justify-between text-xs py-0.5 gap-2';
    if (showChip) {
      const isOther = loc.name === 'Other';
      const chipStyle = isOther ? `background-color:var(--color-cat-default-bg);color:var(--color-cat-default-fg);` : catChipStyle(loc.name);
      const chipBody = isOther ? escHtml(loc.name) : catLabelHtml(loc.name);
      el.innerHTML = `
        <span class="inline-flex items-center text-xs px-2 py-0.5 rounded-full whitespace-nowrap" style="${chipStyle}">${chipBody}</span>
        <span class="text-gray-600 tabular-nums ml-auto shrink-0">${fmt(loc.total)}</span>
      `;
    } else {
      // Leaf scope (merchant rows) — let names wrap naturally; no width clip.
      el.innerHTML = `
        <span class="text-gray-700 font-medium" title="${escHtml(loc.name)}">${escHtml(loc.name)}</span>
        <span class="text-gray-600 tabular-nums ml-2 shrink-0">${fmt(loc.total)}</span>
      `;
    }
    container.appendChild(el);
  });
}

function renderDdCumulative(data, compareData, color) {
  hideCustomTooltip();
  const traces = [];

  // Day-of-month labels (strip leading zero so "01" → "1")
  const dayLabels = data.cumulative_spend.map(d => String(parseInt(d.date.split('-')[2], 10)));

  traces.push({
    type: 'scatter',
    mode: 'lines',
    name: formatMonthLabel(data.year_month),
    x: dayLabels,
    y: data.cumulative_spend.map(d => d.cumulative),
    line: { color, width: 2.5 },
    hoverinfo: 'none',
    showlegend: !!compareData,
  });

  const legendEl = document.getElementById('dd-compare-legend');
  if (legendEl) legendEl.classList.add('hidden');

  if (compareData) {
    const cDayLabels = compareData.cumulative_spend.map(d => String(parseInt(d.date.split('-')[2], 10)));
    traces.push({
      type: 'scatter',
      mode: 'lines',
      name: formatMonthLabel(compareData.year_month),
      x: cDayLabels,
      y: compareData.cumulative_spend.map(d => d.cumulative),
      line: { color: '#9ca3af', width: 2, dash: 'dot' },
      hoverinfo: 'none',
    });
  }

  Plotly.newPlot('dd-cumulative', traces, {
    ...PLOTLY_LAYOUT,
    xaxis: {
      tickfont: { size: 10 },
      gridcolor: '#f3f4f6',
      title: { text: 'Day of month', font: { size: 10 }, standoff: 4 },
    },
    yaxis: {
      tickformat: '$,.0f',
      tickfont: { size: 10 },
      gridcolor: '#f3f4f6',
    },
    margin: { t: 8, r: 16, b: 44, l: 10 },
    showlegend: !!compareData,
    legend: compareData ? { orientation: 'h', y: -0.35, font: { size: 10 } } : undefined,
  }, PLOTLY_CONFIG);

  const cumEl = document.getElementById('dd-cumulative');
  cumEl?.on('plotly_hover',   evt => showCustomTooltip(tipCumulHTML(evt), evt.event));
  cumEl?.on('plotly_unhover', () => hideCustomTooltip());
}

// Cumulative line tooltip — distinguishes the primary line from the compare overlay
// (compare has line.dash === 'dot' in this chart).
function tipCumulHTML(evt) {
  const pt = evt.points?.[0];
  if (!pt) return '';
  const isCompare = pt.data?.line?.dash === 'dot';
  const value = fmt(pt.y || 0);
  return tipCard({
    title: `Day ${pt.x}`,
    meta: pt.data?.name || '',
    value: isCompare ? `Last month: ${value}` : value,
  });
}

function renderDdBubble(data, compareData, color) {
  hideCustomTooltip();
  const txns = data.transactions;
  catBubblePositions = [];

  if (!txns || !txns.length) {
    document.getElementById('dd-bubble').innerHTML =
      '<p class="text-xs text-gray-400 text-center pt-10">No transactions</p>';
    return;
  }

  const GAP      = 4;   // px gap between touching bubbles
  const MIN_SIZE = 10;  // px minimum diameter
  const MAX_SIZE = 44;  // px maximum diameter
  const MARGIN_B = 16;  // px bottom margin

  const compareTxns = compareData && compareData.transactions ? compareData.transactions : [];

  // Shared scale across both months so sizes are comparable
  const maxAmt = Math.max(...txns.map(t => t.amount), ...compareTxns.map(t => t.amount));

  // Helper: stack transactions per day into pixel coordinates
  function stackPositions(transactions) {
    const positions = [];
    const byDay = {};
    transactions.forEach((t, i) => {
      const day = parseInt(t.date.split('-')[2], 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push({ ...t, origIndex: i });
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
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-gray-400" style="opacity:0.45"></span>
          ${escHtml(formatMonthLabel(compareData.year_month))}
        </span>
      `;
      legendEl.classList.remove('hidden');
    } else {
      legendEl.classList.add('hidden');
    }
  }

  // Dynamic height: tallest stack across both sets
  const allPositions = [...catBubblePositions, ...comparePositions];
  const maxY = Math.max(...allPositions.map(p => p.y + p.size / 2));
  const chartH = Math.max(220, Math.ceil(maxY) + 24);
  document.getElementById('dd-bubble').style.height = chartH + 'px';

  const [yr, mo] = data.year_month.split('-').map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();

  const traces = [];

  // Compare trace (grey, rendered behind primary)
  if (comparePositions.length) {
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: formatMonthLabel(compareData.year_month),
      x: comparePositions.map(p => p.x),
      y: comparePositions.map(p => p.y),
      marker: {
        size:     comparePositions.map(p => p.size),
        sizemode: 'diameter',
        color:    '#9ca3af',
        opacity:  0.45,
        line:     { color: 'rgba(255,255,255,0.7)', width: 1 },
      },
      customdata: comparePositions.map(p => ({
        name:      p.name,
        amountStr: fmt(p.amount),
        date:      p.date,
        dow:       DOW_LABELS[new Date(p.date + 'T12:00:00').getDay()],
        isCompare: true,
      })),
      hoverinfo: 'none',
      showlegend: false,
      cliponaxis: false,
    });
  }

  // Primary trace (colored, on top)
  const primaryTraceIdx = traces.length;
  catPrimaryBubbleTraceIdx = primaryTraceIdx;
  traces.push({
    type: 'scatter',
    mode: 'markers',
    x: catBubblePositions.map(p => p.x),
    y: catBubblePositions.map(p => p.y),
    marker: {
      size:     catBubblePositions.map(p => p.size),
      sizemode: 'diameter',
      color:    color,
      opacity:  0.72,
      line:     { color: 'rgba(255,255,255,0.9)', width: 1.5 },
    },
    customdata: catBubblePositions.map(p => ({
      name:       p.name,
      amountStr:  fmt(p.amount),
      date:       p.date,
      dow:        DOW_LABELS[new Date(p.date + 'T12:00:00').getDay()],
      origIndex:  p.origIndex,
    })),
    hoverinfo: 'none',
    showlegend: false,
    cliponaxis: false,
  });

  Plotly.newPlot('dd-bubble', traces, {
    ...PLOTLY_LAYOUT,
    xaxis: {
      range:     [0.5, daysInMonth + 0.5],
      tickmode:  'array',
      tickvals:  Array.from({ length: daysInMonth }, (_, i) => i + 1),
      ticktext:  Array.from({ length: daysInMonth }, (_, i) => `${MONTH_LABELS[mo - 1]} ${i + 1}`),
      tickfont:  { size: 10 },
      gridcolor: '#f3f4f6',
      title:     { text: '', standoff: 4 },
    },
    yaxis: {
      range:       [0, chartH],
      visible:     false,
      fixedrange:  true,
    },
    margin:    { t: 28, r: 28, b: 44, l: 28 },
    hovermode: 'closest',
  }, PLOTLY_CONFIG);

  // Hover does three things in tandem:
  //   1. Show our custom DOM tooltip with merchant + date + amount
  //   2. Highlight the matching table row (primary bubbles only)
  //   3. Dim non-hovered primary bubbles (primary bubbles only)
  document.getElementById('dd-bubble').on('plotly_hover', evtData => {
    showCustomTooltip(tipBubbleHTML(evtData), evtData.event);

    const pt = evtData.points[0];
    if (pt.curveNumber !== primaryTraceIdx) return; // table/dim effects: primary only
    const idx = pt.customdata.origIndex;

    document.querySelectorAll('#dd-table-body tr').forEach(row => {
      row.classList.toggle('bg-accent-50', Number(row.dataset.idx) === idx);
    });

    const opacities = catBubblePositions.map(p => p.origIndex === idx ? 1.0 : 0.18);
    Plotly.restyle('dd-bubble', { 'marker.opacity': [opacities] }, [primaryTraceIdx]);
  });

  document.getElementById('dd-bubble').on('plotly_unhover', () => {
    hideCustomTooltip();
    document.querySelectorAll('#dd-table-body tr').forEach(r => r.classList.remove('bg-accent-50'));
    if (catBubblePositions.length) {
      Plotly.restyle('dd-bubble', {
        'marker.opacity': [Array(catBubblePositions.length).fill(0.72)],
      }, [primaryTraceIdx]);
    }
  });
}

// Bubble tooltip — pulls merchant + date metadata from each point's customdata.
function tipBubbleHTML(evt) {
  const pt = evt.points?.[0];
  if (!pt) return '';
  const cd = pt.customdata || {};
  const name = cd.name || '';
  const meta = [cd.date, cd.dow].filter(Boolean).join(' · ');
  return tipCard({
    title: escHtml(name),
    meta,
    value: cd.amountStr || fmt(pt.y || 0),
  });
}

// Radial tooltip — year + month name + dollar value.
function tipRadialHTML(evt) {
  const pt = evt.points?.[0];
  if (!pt) return '';
  return tipCard({
    title: `${pt.data?.name || ''}`,
    meta: pt.theta || '',
    value: fmt(pt.r || 0),
  });
}

function renderDdTable(data, compareData) {
  const outer = document.getElementById('dd-table-outer');
  outer.innerHTML = '';

  const primaryTxns = data.transactions || [];
  const compareTxns = compareData ? (compareData.transactions || []) : [];
  const hasCompare  = compareTxns.length > 0;

  // Wrap in a grid when comparing, plain div otherwise
  const grid = document.createElement('div');
  grid.className = hasCompare ? 'grid grid-cols-2 gap-5' : '';
  outer.appendChild(grid);

  // Build one self-contained card per panel
  function buildCard(txns, panelMonth, isPrimary) {
    const card = document.createElement('div');
    card.className = 'bg-white border border-gray-200 rounded-lg shadow-sm';

    // Card header
    const hdr = document.createElement('div');
    hdr.className = 'px-6 pt-6 pb-0';
    hdr.innerHTML = `<p class="font-semibold text-xl text-gray-900">
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
        <tr class="border-b border-gray-200">
          <th class="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Date</th>
          <th class="pb-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Merchant</th>
          <th class="pb-2 text-right text-xs font-semibold text-gray-400 uppercase tracking-wide">Amount</th>
        </tr>
      </thead>`;

    const tbody = document.createElement('tbody');
    tbody.className = 'divide-y divide-gray-50';
    if (isPrimary) tbody.id = 'dd-table-body';

    if (!txns.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-xs text-gray-400 py-4">No transactions</td></tr>';
    } else {
      txns.forEach((t, i) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-accent-50 transition-colors cursor-default';
        if (isPrimary) tr.dataset.idx = i;
        tr.innerHTML = `
          <td class="py-2 pr-3 text-xs text-gray-400 whitespace-nowrap">${t.date}</td>
          <td class="py-2 pr-3 text-sm text-gray-700 font-medium truncate max-w-[110px]" title="${escHtml(t.name)}">${escHtml(t.name)}</td>
          <td class="py-2 text-right text-sm text-gray-900 font-medium tabular-nums whitespace-nowrap">${fmt(t.amount)}</td>
        `;

        if (isPrimary) {
          tr.addEventListener('mouseenter', () => {
            if (!catBubblePositions.length) return;
            const opacities = catBubblePositions.map(p => p.origIndex === i ? 1.0 : 0.18);
            Plotly.restyle('dd-bubble', { 'marker.opacity': [opacities] }, [catPrimaryBubbleTraceIdx]);
          });
          tr.addEventListener('mouseleave', () => {
            if (!catBubblePositions.length) return;
            Plotly.restyle('dd-bubble', {
              'marker.opacity': [Array(catBubblePositions.length).fill(0.72)],
            }, [catPrimaryBubbleTraceIdx]);
          });
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
let txnPage = 1;
let txnDayRange = null;  // { start_day, end_day } when navigated from Overview

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
  setPageHeader('Transactions', transactionsSubtitle());
}

async function renderTransactionsTab() {
  if (!txnInited) {
    const cats = await fetch('/api/categories/list').then(r => r.json());

    const catSel = document.getElementById('txn-cat-filter');
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      catSel.appendChild(opt);
    });

    const mSel = document.getElementById('txn-month-filter');

    const onFilterChange = () => {
      txnPage = 1;
      txnDayRange = null;
      renderTransactionsHeader();
      loadTransactions();
    };

    document.getElementById('txn-search').addEventListener('input', debounce(onFilterChange, 300));
    catSel.addEventListener('change', onFilterChange);
    mSel.addEventListener('change',   onFilterChange);
    document.getElementById('txn-prev').addEventListener('click', () => { txnPage--; loadTransactions(); });
    document.getElementById('txn-next').addEventListener('click', () => { txnPage++; loadTransactions(); });

    txnInited = true;
  }

  // Apply nav state from Overview-tab linkouts
  const nav = window.moneyHabitsNav;
  if (nav && nav.tab === 'transactions') {
    document.getElementById('txn-search').value      = '';
    document.getElementById('txn-cat-filter').value  = '';
    document.getElementById('txn-month-filter').value = nav.year_month || '';
    txnPage = 1;
    txnDayRange = (nav.start_day != null && nav.end_day != null)
      ? { start_day: nav.start_day, end_day: nav.end_day }
      : null;
    window.moneyHabitsNav = null;
  }

  renderTransactionsHeader();
  loadTransactions();
}

async function loadTransactions() {
  const search    = document.getElementById('txn-search').value;
  const category  = document.getElementById('txn-cat-filter').value;
  const yearMonth = document.getElementById('txn-month-filter').value;

  const params = new URLSearchParams({ search, category, year_month: yearMonth, page: txnPage });
  if (txnDayRange) {
    params.set('start_day', txnDayRange.start_day);
    params.set('end_day',   txnDayRange.end_day);
  }

  // Need category→parent map before painting chips, otherwise all
  // children fall back to the default-gray slug.
  await loadCategoryMeta();
  const data = await fetch('/api/transactions?' + params).then(r => r.json());

  const tbody = document.getElementById('txn-tbody');
  tbody.innerHTML = '';

  data.rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors';
    tr.innerHTML = `
      <td class="px-4 py-3 text-gray-500 whitespace-nowrap">${formatTxnDate(row.date)}</td>
      <td class="px-4 py-3 font-medium text-gray-800 max-w-xs truncate">${escHtml(row.name)}</td>
      <td class="px-4 py-3 text-gray-500 hidden sm:table-cell">
        <span class="inline-block text-xs px-2 py-0.5 rounded-full" style="${catChipStyle(row.category)}">${catLabelHtml(row.category)}</span>
      </td>
      <td class="px-4 py-3 text-gray-500 hidden md:table-cell text-xs">${escHtml(row.account)}</td>
      <td class="px-4 py-3 text-right font-medium text-gray-800 whitespace-nowrap">${fmt(row.amount)}</td>
    `;
    tbody.appendChild(tr);
  });

  const totalPages = Math.ceil(data.total / data.per_page);
  const start = (txnPage - 1) * data.per_page + 1;
  const end   = Math.min(txnPage * data.per_page, data.total);
  document.getElementById('txn-count').textContent =
    data.total > 0 ? `${start}–${end} of ${data.total.toLocaleString()} transactions` : 'No transactions found';

  document.getElementById('txn-prev').disabled = txnPage <= 1;
  document.getElementById('txn-next').disabled = txnPage >= totalPages;
}

// ── Radial ────────────────────────────────────────────────────────────────────
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_LABELS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const RADIAL_COLORS = ['#3b82f6','#f97316','#6366f1','#10b981','#f43f5e','#eab308'];
const GREY_LINE = '#d1d5db';
const GREY_FILL = '#d1d5db22';

let radialInited = false;
let radialAllData = {};
let selectedRadialYears = new Set();
let activeRadialYear = null;
let activeRadialPointIndex = null;

async function renderRadialTab() {
  if (!radialInited) {
    const cats = await fetch('/api/categories/list').then(r => r.json());
    const catSel = document.getElementById('radial-cat-select');
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      catSel.appendChild(opt);
    });
    catSel.addEventListener('change', async () => {
      if (activeRadialYear) closeTxnPanel();
      await fetchRadialData();
      buildYearCheckboxes();
      loadRadialChart();
    });

    const btn   = document.getElementById('radial-year-btn');
    const panel = document.getElementById('radial-year-panel');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!document.getElementById('radial-year-dropdown').contains(e.target)) {
        panel.classList.add('hidden');
      }
    });

    radialInited = true;
  }
  await fetchRadialData();
  buildYearCheckboxes();
  loadRadialChart();
}

async function fetchRadialData() {
  const cat = document.getElementById('radial-cat-select').value;
  const url = cat ? `/api/radial?category=${encodeURIComponent(cat)}` : '/api/radial';
  radialAllData = await fetch(url).then(r => r.json());
  selectedRadialYears = new Set(Object.keys(radialAllData).sort());
}

function buildYearCheckboxes() {
  const panel = document.getElementById('radial-year-panel');
  panel.innerHTML = '';
  Object.keys(radialAllData).sort().forEach(year => {
    const label = document.createElement('label');
    label.className = 'flex items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = year;
    cb.checked = selectedRadialYears.has(year);
    cb.className = 'accent-indigo-500 w-3.5 h-3.5';
    cb.addEventListener('change', () => {
      if (cb.checked) selectedRadialYears.add(year);
      else {
        selectedRadialYears.delete(year);
        if (activeRadialYear === year) closeTxnPanel();
      }
      updateYearLabel();
      loadRadialChart();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(year));
    panel.appendChild(label);
  });
  updateYearLabel();
}

function updateYearLabel() {
  const all = Object.keys(radialAllData).sort();
  const sel = [...selectedRadialYears].sort();
  const label = document.getElementById('radial-year-label');
  if (sel.length === 0 || sel.length === all.length) label.textContent = 'All years';
  else if (sel.length === 1) label.textContent = sel[0];
  else label.textContent = `${sel.length} years`;
}

function loadRadialChart() {
  const allYears = Object.keys(radialAllData).sort();
  const years = allYears.filter(y => selectedRadialYears.has(y));
  const theta = [...MONTH_LABELS, 'Jan'];

  // Fill-only traces first (so they never cover markers)
  const fillTraces = years.map(year => {
    const colorIdx = allYears.indexOf(year);
    const r = [...radialAllData[year], radialAllData[year][0]];
    return {
      type: 'scatterpolar',
      name: year,
      r,
      theta,
      fill: 'toself',
      fillcolor: RADIAL_COLORS[colorIdx % RADIAL_COLORS.length] + '22',
      mode: 'none',
      showlegend: false,
      hoverinfo: 'skip',
    };
  });

  // Line+marker traces on top
  const lineTraces = years.map(year => {
    const colorIdx = allYears.indexOf(year);
    const r = [...radialAllData[year], radialAllData[year][0]];
    return {
      type: 'scatterpolar',
      name: year,
      r,
      theta,
      fill: 'none',
      mode: 'lines+markers',
      line:   { color: RADIAL_COLORS[colorIdx % RADIAL_COLORS.length], width: 2 },
      marker: { color: RADIAL_COLORS[colorIdx % RADIAL_COLORS.length], size: 5 },
      hoverinfo: 'none',
    };
  });

  hideCustomTooltip();
  Plotly.newPlot('chart-radial', [...fillTraces, ...lineTraces], {
    ...PLOTLY_LAYOUT,
    polar: {
      bgcolor: '#ffffff',
      angularaxis: {
        tickfont: { size: 12, family: 'Inter, ui-sans-serif, system-ui, sans-serif' },
        direction: 'clockwise',
        rotation: 90,
        gridcolor: '#e5e7eb',
        linecolor: '#e5e7eb',
      },
      radialaxis: {
        showticklabels: false,
        ticks: '',
        gridcolor: '#f3f4f6',
        linecolor: '#e5e7eb',
        angle: 90,
      },
    },
    legend: {
      orientation: 'h',
      y: -0.08,
      x: 0.5,
      xanchor: 'center',
      font: { size: 12 },
      itemclick: false,
      itemdoubleclick: false,
    },
    margin: { t: 20, r: 40, b: 60, l: 40 },
  }, PLOTLY_CONFIG);

  const radialEl = document.getElementById('chart-radial');
  radialEl.on('plotly_hover',   evt => showCustomTooltip(tipRadialHTML(evt), evt.event));
  radialEl.on('plotly_unhover', () => hideCustomTooltip());

  document.getElementById('chart-radial').on('plotly_click', pointData => {
    const pt = pointData.points[0];
    if (pt.curveNumber < years.length) return;
    const monthLabel = pt.theta === 'Jan' && pt.pointIndex === 12 ? 'Jan' : pt.theta;
    const monthNum   = MONTH_NUM[monthLabel];
    if (!monthNum) return;
    const year      = pt.data.name;
    const yearMonth = `${year}-${String(monthNum).padStart(2, '0')}`;
    const category  = document.getElementById('radial-cat-select').value;
    const panelOpen = document.getElementById('txn-panel').classList.contains('panel-open');

    if (panelOpen && activeRadialYear === year && activeRadialPointIndex === pt.pointIndex) {
      closeTxnPanel();
    } else {
      activeRadialYear = year;
      activeRadialPointIndex = pt.pointIndex;
      highlightRadialYear(year, pt.pointIndex);
      openTxnPanel(yearMonth, category);
    }
  });
}

function highlightRadialYear(year, pointIndex = null) {
  const allYears = Object.keys(radialAllData).sort();
  const visible  = allYears.filter(y => selectedRadialYears.has(y));
  const n        = visible.length;
  const numPoints = 13;

  const fillColors = visible.map(y => {
    const idx = allYears.indexOf(y);
    return y === year ? RADIAL_COLORS[idx % RADIAL_COLORS.length] + '22' : GREY_FILL;
  });
  Plotly.restyle('chart-radial', { fillcolor: fillColors }, visible.map((_, i) => i));

  const activeVisibleIdx = visible.indexOf(year);
  const activeTraceIdx   = n + activeVisibleIdx;
  const activeColor      = RADIAL_COLORS[allYears.indexOf(year) % RADIAL_COLORS.length];
  const activeSizes      = Array.from({ length: numPoints }, (_, i) => i === pointIndex ? 16 : 0);

  Plotly.restyle('chart-radial',
    { 'line.color': [activeColor], 'marker.color': [activeColor], 'marker.size': [activeSizes] },
    [activeTraceIdx]
  );

  const inactiveIndices = visible.map((_, i) => i + n).filter(i => i !== activeTraceIdx);
  if (inactiveIndices.length) {
    Plotly.restyle('chart-radial',
      { 'line.color': GREY_LINE, 'marker.color': GREY_LINE, 'marker.size': Array(numPoints).fill(0) },
      inactiveIndices
    );
  }
}

function resetRadialColors() {
  if (!radialAllData || Object.keys(radialAllData).length === 0) return;
  const allYears = Object.keys(radialAllData).sort();
  const visible  = allYears.filter(y => selectedRadialYears.has(y));
  const n        = visible.length;
  const fillColors = visible.map(y => RADIAL_COLORS[allYears.indexOf(y) % RADIAL_COLORS.length] + '22');
  const lineColors = visible.map(y => RADIAL_COLORS[allYears.indexOf(y) % RADIAL_COLORS.length]);

  Plotly.restyle('chart-radial', { fillcolor: fillColors }, visible.map((_, i) => i));
  Plotly.restyle('chart-radial', {
    'line.color':   lineColors,
    'marker.color': lineColors,
    'marker.size':  5,
  }, visible.map((_, i) => i + n));
}

// ── Transaction side panel ────────────────────────────────────────────────────
const MONTH_NUM = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};

function openTxnPanel(yearMonth, category) {
  const panel = document.getElementById('txn-panel');

  const [year, mon] = yearMonth.split('-');
  const monthName = MONTH_LABELS[parseInt(mon, 10) - 1];
  document.getElementById('txn-panel-title').textContent = category || 'All spending';
  document.getElementById('txn-panel-meta').textContent  = `${monthName} ${year}`;

  const allYears  = Object.keys(radialAllData).sort();
  const colorIdx  = allYears.indexOf(year);
  const yearColor = colorIdx >= 0 ? RADIAL_COLORS[colorIdx % RADIAL_COLORS.length] : '#6366f1';
  document.getElementById('txn-panel-color-dot').style.backgroundColor = yearColor;

  document.getElementById('txn-panel-tbody').innerHTML = '';
  document.getElementById('txn-panel-empty').classList.add('hidden');
  document.getElementById('txn-panel-callout').textContent = '—';
  document.getElementById('txn-panel-count').textContent = 'Loading…';
  document.getElementById('txn-panel-total').textContent = '';

  panel.classList.add('panel-open');

  const params = new URLSearchParams({ year_month: yearMonth, per_page: 500, page: 1 });
  if (category) params.set('category', category);

  fetch('/api/transactions?' + params)
    .then(r => r.json())
    .then(data => populateTxnPanel(data));
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
    tr.className = 'hover:bg-gray-50 transition-colors';
    tr.innerHTML = `
      <td class="px-5 py-3 text-gray-400 whitespace-nowrap text-xs">${row.date}</td>
      <td class="px-5 py-3 text-gray-800 font-medium max-w-[180px] truncate">${escHtml(row.name)}</td>
      <td class="px-5 py-3 text-right text-gray-800 font-medium whitespace-nowrap">${fmt(row.amount)}</td>
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
  if (activeRadialYear) {
    activeRadialYear = null;
    activeRadialPointIndex = null;
    resetRadialColors();
  }
}

document.getElementById('txn-panel-close').addEventListener('click', closeTxnPanel);

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

// ── Boot ──────────────────────────────────────────────────────────────────────
showTab('overview');
