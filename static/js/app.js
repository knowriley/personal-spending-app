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

// ── Tab navigation ────────────────────────────────────────────────────────────
const tabs = ['overview', 'categories', 'trends', 'transactions'];
let activeTab = 'overview';

function showTab(name) {
  activeTab = name;

  document.querySelectorAll('.tab-section').forEach(el => el.classList.add('hidden'));
  document.getElementById('tab-' + name).classList.remove('hidden');

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('bg-accent-100', active);
    btn.classList.toggle('text-accent-700', active);
    btn.classList.toggle('text-gray-600', !active);
    btn.classList.toggle('hover:bg-gray-100', !active);
  });

  if (name === 'categories')   renderCategoriesTab();
  if (name === 'trends')       renderTrendsTab();
  if (name === 'transactions') renderTransactionsTab();
  if (name === 'radial')       renderRadialTab();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ── Overview ──────────────────────────────────────────────────────────────────
async function initOverview() {
  const [summary, monthly] = await Promise.all([
    fetch('/api/summary').then(r => r.json()),
    fetch('/api/monthly').then(r => r.json()),
  ]);

  document.getElementById('kpi-this-month').textContent = fmt(summary.this_month);
  document.getElementById('kpi-last-month').textContent  = fmt(summary.last_month);
  document.getElementById('kpi-avg').textContent         = fmt(summary.three_month_avg);
  document.getElementById('kpi-top-cat').textContent     = summary.top_category;

  const months = monthly.map(d => d.month);
  const totals = monthly.map(d => d.total);

  Plotly.newPlot('chart-monthly', [{
    type: 'bar',
    x: months,
    y: totals,
    marker: { color: '#6366f1' },
    hovertemplate: '%{x}<br><b>%{y:$,.0f}</b><extra></extra>',
  }], {
    ...PLOTLY_LAYOUT,
    xaxis: { tickfont: { size: 11 }, tickangle: -45 },
    yaxis: { tickformat: '$,.0f', tickfont: { size: 11 }, gridcolor: '#f3f4f6' },
    bargap: 0.3,
  }, PLOTLY_CONFIG);

  // Clicking a bar drills into categories tab
  document.getElementById('chart-monthly').on('plotly_click', data => {
    const month = data.points[0].x;
    showTab('categories');
    document.getElementById('cat-month-select').value = month;
    loadCategoryCharts(month);
  });
}

// ── Categories ────────────────────────────────────────────────────────────────
let catMonthsLoaded = false;

async function renderCategoriesTab() {
  if (!catMonthsLoaded) {
    const months = await fetch('/api/months/list').then(r => r.json());
    const sel = document.getElementById('cat-month-select');
    months.slice().reverse().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => loadCategoryCharts(sel.value || null));
    catMonthsLoaded = true;
  }
  loadCategoryCharts(document.getElementById('cat-month-select').value || null);
}

async function loadCategoryCharts(yearMonth) {
  const url = yearMonth ? `/api/categories?year_month=${yearMonth}` : '/api/categories';
  const data = await fetch(url).then(r => r.json());

  const TOP_N = 8;
  const top   = data.slice(0, TOP_N);
  const other = data.slice(TOP_N).reduce((s, d) => s + d.total, 0);
  const donut_labels = top.map(d => d.category);
  const donut_values = top.map(d => d.total);
  if (other > 0) { donut_labels.push('Other'); donut_values.push(+other.toFixed(2)); }

  Plotly.newPlot('chart-cat-donut', [{
    type: 'pie',
    labels: donut_labels,
    values: donut_values,
    hole: 0.5,
    textinfo: 'percent',
    hovertemplate: '<b>%{label}</b><br>%{value:$,.0f}<br>%{percent}<extra></extra>',
    marker: { colors: PLOTLY_LAYOUT.colorway },
  }], {
    ...PLOTLY_LAYOUT,
    showlegend: true,
    legend: { orientation: 'v', font: { size: 11 } },
    margin: { t: 10, r: 10, b: 10, l: 10 },
  }, PLOTLY_CONFIG);

  // Horizontal bar — all categories
  const sorted = [...data].sort((a, b) => a.total - b.total);
  Plotly.newPlot('chart-cat-bar', [{
    type: 'bar',
    orientation: 'h',
    x: sorted.map(d => d.total),
    y: sorted.map(d => d.category),
    marker: { color: '#6366f1' },
    hovertemplate: '<b>%{y}</b><br>%{x:$,.0f}<extra></extra>',
  }], {
    ...PLOTLY_LAYOUT,
    margin: { t: 10, r: 30, b: 40, l: 10 },
    xaxis: { tickformat: '$,.0f', tickfont: { size: 11 }, gridcolor: '#f3f4f6' },
    yaxis: { tickfont: { size: 11 }, automargin: true },
  }, PLOTLY_CONFIG);
}

// ── Trends ────────────────────────────────────────────────────────────────────
let trendsInited = false;
let selectedTrendCats = new Set();
let allMonths = [];

async function renderTrendsTab() {
  if (!trendsInited) {
    const [cats, months] = await Promise.all([
      fetch('/api/categories/list').then(r => r.json()),
      fetch('/api/months/list').then(r => r.json()),
    ]);
    allMonths = months;

    // Default: top 5 categories by all-time spend
    const topData = await fetch('/api/categories').then(r => r.json());
    const defaults = topData.slice(0, 5).map(d => d.category);
    defaults.forEach(c => selectedTrendCats.add(c));

    // Pills
    const pillContainer = document.getElementById('trends-cat-pills');
    cats.forEach(cat => {
      const pill = document.createElement('button');
      pill.textContent = cat;
      pill.dataset.cat = cat;
      pill.className = 'trend-pill text-xs px-2.5 py-1 rounded-full border transition-colors';
      applyPillStyle(pill, selectedTrendCats.has(cat));
      pill.addEventListener('click', () => {
        if (selectedTrendCats.has(cat)) selectedTrendCats.delete(cat);
        else selectedTrendCats.add(cat);
        applyPillStyle(pill, selectedTrendCats.has(cat));
        loadTrendsChart();
      });
      pillContainer.appendChild(pill);
    });

    // Date range selects
    const startSel = document.getElementById('trends-start');
    const endSel   = document.getElementById('trends-end');
    months.forEach(m => {
      [startSel, endSel].forEach(sel => {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        sel.appendChild(opt);
      });
    });
    startSel.value = months[0];
    endSel.value   = months[months.length - 1];
    startSel.addEventListener('change', loadTrendsChart);
    endSel.addEventListener('change',   loadTrendsChart);

    trendsInited = true;
  }
  loadTrendsChart();
}

function applyPillStyle(pill, active) {
  pill.classList.toggle('bg-accent-500',  active);
  pill.classList.toggle('text-white',     active);
  pill.classList.toggle('border-accent-500', active);
  pill.classList.toggle('bg-white',       !active);
  pill.classList.toggle('text-gray-600',  !active);
  pill.classList.toggle('border-gray-200',!active);
  pill.classList.toggle('hover:border-accent-500', !active);
}

async function loadTrendsChart() {
  if (selectedTrendCats.size === 0) {
    Plotly.purge('chart-trends');
    return;
  }

  const startVal = document.getElementById('trends-start').value;
  const endVal   = document.getElementById('trends-end').value;
  const catParam = encodeURIComponent([...selectedTrendCats].join(','));
  const data = await fetch(`/api/trends?categories=${catParam}`).then(r => r.json());

  const traces = Object.entries(data).map(([cat, points]) => {
    const filtered = points.filter(p => p.month >= startVal && p.month <= endVal);
    return {
      type: 'scatter',
      mode: 'lines+markers',
      name: cat,
      x: filtered.map(p => p.month),
      y: filtered.map(p => p.total),
      hovertemplate: `<b>${cat}</b><br>%{x}<br>%{y:$,.0f}<extra></extra>`,
      line: { width: 2 },
      marker: { size: 5 },
    };
  });

  Plotly.newPlot('chart-trends', traces, {
    ...PLOTLY_LAYOUT,
    xaxis: { tickfont: { size: 11 }, tickangle: -45 },
    yaxis: { tickformat: '$,.0f', tickfont: { size: 11 }, gridcolor: '#f3f4f6' },
    legend: { orientation: 'h', y: -0.25, font: { size: 11 } },
    margin: { t: 10, r: 10, b: 80, l: 10 },
  }, PLOTLY_CONFIG);
}

// ── Transactions ──────────────────────────────────────────────────────────────
let txnInited = false;
let txnPage = 1;

async function renderTransactionsTab() {
  if (!txnInited) {
    const [cats, months] = await Promise.all([
      fetch('/api/categories/list').then(r => r.json()),
      fetch('/api/months/list').then(r => r.json()),
    ]);

    const catSel = document.getElementById('txn-cat-filter');
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      catSel.appendChild(opt);
    });

    const mSel = document.getElementById('txn-month-filter');
    months.slice().reverse().forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      mSel.appendChild(opt);
    });

    document.getElementById('txn-search').addEventListener('input', debounce(() => { txnPage = 1; loadTransactions(); }, 300));
    catSel.addEventListener('change', () => { txnPage = 1; loadTransactions(); });
    mSel.addEventListener('change',   () => { txnPage = 1; loadTransactions(); });
    document.getElementById('txn-prev').addEventListener('click', () => { txnPage--; loadTransactions(); });
    document.getElementById('txn-next').addEventListener('click', () => { txnPage++; loadTransactions(); });

    txnInited = true;
  }
  loadTransactions();
}

async function loadTransactions() {
  const search    = document.getElementById('txn-search').value;
  const category  = document.getElementById('txn-cat-filter').value;
  const yearMonth = document.getElementById('txn-month-filter').value;

  const params = new URLSearchParams({ search, category, year_month: yearMonth, page: txnPage });
  const data = await fetch('/api/transactions?' + params).then(r => r.json());

  const tbody = document.getElementById('txn-tbody');
  tbody.innerHTML = '';

  data.rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 transition-colors';
    tr.innerHTML = `
      <td class="px-4 py-3 text-gray-500 whitespace-nowrap">${row.date}</td>
      <td class="px-4 py-3 font-medium text-gray-800 max-w-xs truncate">${escHtml(row.name)}</td>
      <td class="px-4 py-3 text-gray-500 hidden sm:table-cell">
        <span class="inline-block bg-accent-50 text-accent-700 text-xs px-2 py-0.5 rounded-full">${escHtml(row.category)}</span>
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

// One distinct color per year — up to 6 years visible
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
    // Category dropdown
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

    // Year multi-select dropdown toggle
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
  // Default: all years selected
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
        // If the deselected year is the one currently shown in the panel, close it
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

  // Pass 1 (indices 0..N-1): fill-only traces — rendered first so fills never cover markers
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

  // Pass 2 (indices N..2N-1): line+marker traces — rendered on top of all fills
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
      hovertemplate: `<b>${year}</b> — %{theta}<br><b>%{r:$,.0f}</b><extra></extra>`,
    };
  });

  const traces = [...fillTraces, ...lineTraces];

  Plotly.newPlot('chart-radial', traces, {
    ...PLOTLY_LAYOUT,
    polar: {
      bgcolor: '#ffffff',
      angularaxis: {
        tickfont: { size: 12, family: 'Inter, ui-sans-serif, system-ui, sans-serif' },
        direction: 'clockwise',
        rotation: 90,         // Jan at top
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

  // Click a node → highlight year + open panel; same node again → close + reset
  document.getElementById('chart-radial').on('plotly_click', pointData => {
    const pt = pointData.points[0];
    // Ignore clicks on fill-only traces (indices 0..N-1); only handle line+marker traces
    if (pt.curveNumber < years.length) return;
    const monthLabel = pt.theta === 'Jan' && pt.pointIndex === 12 ? 'Jan' : pt.theta;
    const monthNum   = MONTH_NUM[monthLabel];
    if (!monthNum) return;
    const year      = pt.data.name;
    const yearMonth = `${year}-${String(monthNum).padStart(2, '0')}`;
    const category  = document.getElementById('radial-cat-select').value;
    const panelOpen = document.getElementById('txn-panel').classList.contains('panel-open');

    if (panelOpen && activeRadialYear === year && activeRadialPointIndex === pt.pointIndex) {
      // Exact same node clicked again — toggle off
      closeTxnPanel();
    } else {
      // New node (or panel was closed) — highlight + open
      activeRadialYear = year;
      activeRadialPointIndex = pt.pointIndex;
      highlightRadialYear(year, pt.pointIndex);
      openTxnPanel(yearMonth, category);
    }
  });
}

// ── Radial highlight helpers ──────────────────────────────────────────────────
function highlightRadialYear(year, pointIndex = null) {
  const allYears  = Object.keys(radialAllData).sort();
  const visible   = allYears.filter(y => selectedRadialYears.has(y));
  const n         = visible.length;
  const numPoints = 13; // 12 months + loop-close point

  const fillColors = visible.map(y => {
    const idx = allYears.indexOf(y);
    return y === year ? RADIAL_COLORS[idx % RADIAL_COLORS.length] + '22' : GREY_FILL;
  });
  const lineColors = visible.map(y => {
    const idx = allYears.indexOf(y);
    return y === year ? RADIAL_COLORS[idx % RADIAL_COLORS.length] : GREY_LINE;
  });

  // Fill traces occupy indices 0..N-1
  Plotly.restyle('chart-radial', { fillcolor: fillColors }, visible.map((_, i) => i));

  // Line+marker traces occupy indices N..2N-1
  // Restyle active and inactive traces separately so scalar colors are applied cleanly
  const activeVisibleIdx = visible.indexOf(year);
  const activeTraceIdx   = n + activeVisibleIdx;
  const activeColor      = RADIAL_COLORS[allYears.indexOf(year) % RADIAL_COLORS.length];

  // Active trace — solid color, large marker at the clicked point, no other markers
  const activeSizes = Array.from({ length: numPoints }, (_, i) => i === pointIndex ? 16 : 0);
  Plotly.restyle('chart-radial',
    { 'line.color': [activeColor], 'marker.color': [activeColor], 'marker.size': [activeSizes] },
    [activeTraceIdx]
  );

  // Inactive traces — grey line, all markers hidden
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

  // Fill traces: indices 0..N-1
  Plotly.restyle('chart-radial', { fillcolor: fillColors }, visible.map((_, i) => i));

  // Line+marker traces: indices N..2N-1
  Plotly.restyle('chart-radial', {
    'line.color': lineColors,
    'marker.color': lineColors,
    'marker.size': 5,
  }, visible.map((_, i) => i + n));
}

// ── Transaction side panel ────────────────────────────────────────────────────
const MONTH_NUM = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};

function openTxnPanel(yearMonth, category) {
  const panel = document.getElementById('txn-panel');

  // Header labels
  const [year, mon] = yearMonth.split('-');
  const monthName = MONTH_LABELS[parseInt(mon, 10) - 1];
  document.getElementById('txn-panel-title').textContent = category || 'All spending';
  document.getElementById('txn-panel-meta').textContent  = `${monthName} ${year}`;

  // Color dot — match the year's radial chart color
  const allYears  = Object.keys(radialAllData).sort();
  const colorIdx  = allYears.indexOf(year);
  const yearColor = colorIdx >= 0 ? RADIAL_COLORS[colorIdx % RADIAL_COLORS.length] : '#6366f1';
  document.getElementById('txn-panel-color-dot').style.backgroundColor = yearColor;

  // Reset to loading state
  document.getElementById('txn-panel-tbody').innerHTML = '';
  document.getElementById('txn-panel-empty').classList.add('hidden');
  document.getElementById('txn-panel-callout').textContent = '—';
  document.getElementById('txn-panel-count').textContent = 'Loading…';
  document.getElementById('txn-panel-total').textContent = '';

  panel.classList.add('panel-open');

  // Fetch all rows for this month+category (capped at 500 — plenty for any single month)
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
initOverview();
showTab('overview');
