// ── MoneyHabitsRadial ─────────────────────────────────────────────────────────
// Hand-rolled SVG year-over-year radial chart (M9 — replaces the v1 polar
// chart). One nested ring per selected year; 12 month spokes at 30°
// starting at the top (Jan = 12 o'clock), clockwise. Radius is linear against a
// max shared across all visible years, so rings are directly comparable.
//
// This module is a pure VIEW + hit-test layer: it renders the SVG and emits
// month hover/click + year-swatch click via callbacks. app.js owns all state
// (selected years, the click-pinned year, the focused month) and the tooltip
// (#ct-tip). Desktop-only — app.js gates the
// chart-type toggle below 768px.
//
// API (on window.MoneyHabitsRadial):
//   render(container, opts)        — (re)draw into the container element
//   setHighlight(container, year)  — spotlight one year (dim others); null clears
//   destroy(container)             — remove the SVG + listeners
//
// opts: {
//   data:          { "2026": [12 floats], ... },   // raw monthly totals
//   years:         ["2026","2025"],                 // visible, MOST-RECENT FIRST (index 0)
//   colorForYear:  (year, idx) => "#hex",           // idx 0 = most recent
//   ariaLabel:     "…",
//   onMonthClick:  ({ year, month }) => {},          // month is 1..12
//   onMonthHover:  ({ year, month, monthName, value, event }) => {},
//   onMonthLeave:  () => {},
//   onYearClick:   (year) => {},                     // legend swatch → pin toggle
// }
(function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const CX = 200, CY = 200, R = 160;      // viewBox 400×400, center, max radius
  const GRID_STEPS = [0.25, 0.5, 0.75, 1]; // faint reference rings (no $ labels)
  const DOT = 4, DOT_HIT = 11, DOT_HOVER = 7;
  const DIM = 0.18;

  // month angle: Jan at top, clockwise (SVG y grows downward).
  const angleFor = (i) => -Math.PI / 2 + i * (Math.PI / 6);
  const point = (radius, i) => [CX + radius * Math.cos(angleFor(i)), CY + radius * Math.sin(angleFor(i))];

  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function render(container, opts) {
    if (!container) return;
    destroy(container);

    const { data, years, colorForYear, ariaLabel,
            onMonthClick, onMonthHover, onMonthLeave, onYearClick } = opts;

    // Shared max across every visible year × all 12 months → comparable rings.
    let maxVal = 0;
    years.forEach(y => (data[y] || []).forEach(v => { if (v > maxVal) maxVal = v; }));
    if (maxVal <= 0) maxVal = 1;
    const radiusFor = (v) => (Math.max(0, v) / maxVal) * R;

    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col items-center h-full';

    const svg = el('svg', {
      viewBox: '0 0 400 400',
      role: 'img',
      'aria-label': ariaLabel || 'Year-over-year radial chart',
      style: 'display:block;height:calc(100% - 40px);max-width:100%;margin:0 auto;overflow:visible;',
    });

    // ── static layer: faint grid rings + spokes + month labels ──
    const grid = el('g', {}, svg);
    GRID_STEPS.forEach(step => el('circle', {
      cx: CX, cy: CY, r: R * step,
      fill: 'none', stroke: 'var(--color-gray-100)', 'stroke-width': 1,
    }, grid));
    for (let i = 0; i < 12; i++) {
      const [ex, ey] = point(R, i);
      el('line', { x1: CX, y1: CY, x2: ex, y2: ey, stroke: 'var(--color-gray-100)', 'stroke-width': 1 }, grid);
      const [lx, ly] = point(R + 16, i);
      const t = el('text', {
        x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': 12, fill: 'var(--color-gray-500)',
        'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
      }, grid);
      t.textContent = MONTHS[i];
    }

    // ── year rings: oldest drawn first so the most-recent sits on top ──
    const ringLayer = el('g', {}, svg);
    const yearGroups = {};
    [...years].reverse().forEach(year => {
      const idx = years.indexOf(year);          // 0 = most recent (darkest)
      const color = colorForYear(year, idx);
      const vals = data[year] || [];
      const g = el('g', { 'data-year': year }, ringLayer);
      yearGroups[year] = g;

      // closed polygon through the 12 nodes
      const pts = vals.map((v, i) => point(radiusFor(v), i));
      const d = 'M ' + pts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L ') + ' Z';
      el('path', { d, fill: color, 'fill-opacity': 0.13, stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);

      // visible nodes + larger transparent hit targets (topmost captures hover)
      pts.forEach((p, i) => {
        el('circle', { cx: p[0], cy: p[1], r: DOT, fill: color, class: 'mh-radial-dot' }, g);
        const hit = el('circle', {
          cx: p[0], cy: p[1], r: DOT_HIT, fill: 'transparent', style: 'cursor:pointer;',
          'data-year': year, 'data-month': i,
        }, g);
        const value = vals[i] || 0;
        hit.addEventListener('mouseenter', (event) => {
          // grow the matching visible dot
          const dot = hit.previousSibling;
          if (dot) dot.setAttribute('r', DOT_HOVER);
          onMonthHover && onMonthHover({ year, month: i + 1, monthName: MONTHS[i], value, event });
        });
        hit.addEventListener('mousemove', (event) => {
          onMonthHover && onMonthHover({ year, month: i + 1, monthName: MONTHS[i], value, event });
        });
        hit.addEventListener('mouseleave', () => {
          const dot = hit.previousSibling;
          if (dot) dot.setAttribute('r', DOT);
          onMonthLeave && onMonthLeave();
        });
        hit.addEventListener('click', () => onMonthClick && onMonthClick({ year, month: i + 1 }));
      });
    });

    wrap.appendChild(svg);

    // ── legend: color swatch + year; click toggles the pin (onYearClick) ──
    const legend = document.createElement('div');
    legend.className = 'flex items-center justify-center gap-4 flex-wrap pt-2';
    legend.style.height = '40px';
    years.forEach((year, idx) => {
      const color = colorForYear(year, idx);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flex items-center gap-1.5 text-xs text-neutral-600 hover:opacity-70 cursor-pointer';
      btn.setAttribute('data-year', year);
      btn.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:9999px;background:${color};"></span>${year}`;
      btn.addEventListener('click', () => onYearClick && onYearClick(year));
      legend.appendChild(btn);
    });
    wrap.appendChild(legend);

    container.innerHTML = '';
    container.appendChild(wrap);
    container.__radial = { yearGroups, svg };
  }

  function setHighlight(container, year) {
    const inst = container && container.__radial;
    if (!inst) return;
    Object.entries(inst.yearGroups).forEach(([y, g]) => {
      g.setAttribute('opacity', !year || y === year ? 1 : DIM);
    });
  }

  function destroy(container) {
    if (!container) return;
    if (container.__radial) delete container.__radial;
    container.innerHTML = '';
  }

  window.MoneyHabitsRadial = { render, setHighlight, destroy };
})();
