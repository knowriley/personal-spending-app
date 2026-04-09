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

  if (name === 'categories') renderCategoriesTab();
  if (name === 'trends')     renderTrendsTab();
  if (name === 'transactions') renderTransactionsTab();
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
