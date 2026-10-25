/* app.js - loads the CSVs, cleans them once, and renders the dashboard.
 * All calculations come from cleaning.js (window.Fleet); this file only handles state and the DOM. */
(function () {
  'use strict';

  // Add a CSV here to load it. Paths are relative so GitHub Pages project sites work.
  const DATA_FILES = {
    vehicles: 'data/vehicles.csv',
    drivers: 'data/drivers.csv',
    trips: 'data/trips.csv',
    telemetry: 'data/telemetry_samples.csv',
    events: 'data/driver_events.csv'
  };

  const state = { data: null, filters: { cls: '', vehicle: '', route: '', from: '', to: '' }, sort: { key: 'vehicleId', dir: 1 } };
  const charts = {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x)) ? '–' : Number(x).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const label = s => String(s).replace(/_/g, ' ');
  const dateLabel = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const COLORS = ['#2f7d5b', '#c2570c', '#2563a8', '#8a4fb0', '#b0306b', '#6b7a00', '#0e8a91', '#555555'];

  // ---------- loading ----------
  function loadCsv(url) {
    return new Promise((resolve, reject) => {
      Papa.parse(url, {
        download: true, header: true, skipEmptyLines: true,
        complete: res => {
          if (!res.data.length) return reject(new Error(url + ' is empty'));
          resolve(res.data);
        },
        error: err => reject(new Error('Could not load ' + url + ' (' + (err && err.message || err) + ')'))
      });
    });
  }
  async function init() {
    try {
      if (typeof Papa === 'undefined' || typeof Chart === 'undefined') throw new Error('A required library did not load (Papa Parse or Chart.js). Check your internet connection.');
      const keys = Object.keys(DATA_FILES);
      const loaded = await Promise.all(keys.map(k => loadCsv(DATA_FILES[k])));
      const raw = {}; keys.forEach((k, i) => { raw[k] = loaded[i]; });
      state.data = Fleet.cleanAll(raw);          // cleaned ONCE, then reused everywhere
      if (!state.data.telemetry.length) throw new Error('No usable telemetry rows after cleaning.');
      $('loading').hidden = true; $('app').hidden = false;
      setupFilters(); renderStatic(); render();
    } catch (err) {
      $('loading').hidden = true;
      const e = $('error'); e.hidden = false;
      e.innerHTML = '<strong>The data could not be loaded.</strong><br>' + esc(err.message) +
        '<br><small>If you opened index.html directly from disk, run a local web server instead (see README).</small>';
    }
  }

  // ---------- filters ----------
  function setupFilters() {
    const d = state.data;
    fill($('fClass'), ['', ...new Set(d.vehicles.map(v => v.vehicleClass))], 'All classes');
    fill($('fRoute'), ['', ...new Set(d.trips.map(t => t.route))], 'All routes');
    refreshVehicleOptions();
    $('fFrom').min = $('fTo').min = d.days[0]; $('fFrom').max = $('fTo').max = d.days[d.days.length - 1];
    $('fClass').onchange = e => { state.filters.cls = e.target.value; state.filters.vehicle = ''; refreshVehicleOptions(); render(); };
    $('fVehicle').onchange = e => { state.filters.vehicle = e.target.value; render(); };
    $('fRoute').onchange = e => { state.filters.route = e.target.value; render(); };
    $('fFrom').onchange = e => { state.filters.from = e.target.value; render(); };
    $('fTo').onchange = e => { state.filters.to = e.target.value; render(); };
    $('fReset').onclick = () => {
      state.filters = { cls: '', vehicle: '', route: '', from: '', to: '' };
      ['fClass', 'fVehicle', 'fRoute', 'fFrom', 'fTo'].forEach(id => { $(id).value = ''; });
      refreshVehicleOptions(); render();
    };
  }
  function fill(sel, values, allLabel) {
    sel.innerHTML = values.map(v => '<option value="' + esc(v) + '">' + esc(v === '' ? allLabel : label(v)) + '</option>').join('');
  }
  function refreshVehicleOptions() {
    const f = state.filters;
    const ids = state.data.vehicles.filter(v => !f.cls || v.vehicleClass === f.cls).map(v => v.vehicleId);
    fill($('fVehicle'), ['', ...ids], 'All vehicles'); $('fVehicle').value = f.vehicle;
  }

  // ---------- rendering that does not depend on filters ----------
  function renderStatic() {
    const d = state.data, q = d.quality;
    $('period').textContent = dateLabel(d.days[0]) + ' – ' + dateLabel(d.days[d.days.length - 1]) + ' 2026';
    const all = Fleet.summarise(d.telemetry, d.events);
    $('qualityBanner').innerHTML = '<strong>Data quality:</strong> ' + q.duplicateSamples + ' duplicate telemetry rows and ' + q.duplicateEvents +
      ' duplicate events were removed. Fuel efficiency uses the ' + num(all.fuelCoverage * 100, 1) + '% of intervals with valid fuel <em>and</em> distance. ' +
      '<a href="#quality">Details</a>';

    const f1 = Fleet.fuelFinding(d), f2 = Fleet.idleFinding(d);
    const cards = [];
    if (f1) {
      const v = f1.vehicle;
      cards.push('<div class="card"><span class="tag">Fuel</span><h3>' + esc(v.vehicleId) + ' uses ' + num(f1.gapPct, 0) + '% more fuel than its peer</h3>' +
        '<p class="big">' + esc(v.vehicleId) + ' (' + esc(label(v.vehicleClass)) + ') averaged <strong>' + num(v.l100) + ' L/100 km</strong> against <strong>' +
        num(f1.peerL100) + '</strong> for ' + esc(f1.peerIds.join(', ')) + ' (same class, same main route type), and ' + num(v.vsBenchmarkPct, 0) +
        '% above the illustrative benchmark of ' + num(v.benchmark, 0) + '. At the peer rate that is roughly <strong>' + num(f1.excessL, 0) +
        ' extra litres</strong> over ' + num(v.kmPaired, 0) + ' km.</p>' +
        '<ul><li>Higher than the peer in ' + f1.higherInBands + ' of 3 load bands.</li><li>' + f1.sharedDrivers + ' of ' + f1.totalDrivers +
        ' drivers who drove it also drove the peer, so a single driver is an unlikely explanation.</li></ul>' +
        '<p class="caveat">Suggested check: vehicle condition (tyres, maintenance, fuel-system or sensor calibration). Only one peer vehicle, two weeks of data; ' +
        'weather and exact routes are not controlled. Not a finding of fault.</p></div>');
    }
    if (f2) {
      const v = f2.vehicle;
      cards.push('<div class="card"><span class="tag">Idling</span><h3>' + esc(v.vehicleId) + ' idle share jumped from ' + num(f2.first.idlePct, 0) + '% to ' + num(f2.second.idlePct, 0) + '%</h3>' +
        '<p class="big">From ' + dateLabel(f2.splitDay) + ', ' + esc(v.vehicleId) + ' (' + esc(label(v.vehicleClass)) + ') spent <strong>' + num(f2.second.idlePct, 0) +
        '% of engine-on time idling</strong>, versus ' + num(f2.first.idlePct, 0) + '% earlier and ' + num(f2.peerIdlePct, 0) + '% for ' + esc(f2.peerIds.join(', ')) +
        ' in the same period. Idle hours rose from ' + num(f2.first.idleHours) + ' to ' + num(f2.second.idleHours) + '.</p>' +
        '<ul><li>Seen across all ' + f2.allDriversAffected + ' drivers who drove it, so it points at the vehicle or its work rather than one person.</li>' +
        '<li>Fuel rose from ' + num(f2.first.l100) + ' to ' + num(f2.second.l100) + ' L/100 km (fuel already includes idling).</li>' +
        '<li>Planned trip length also changed: ' + num(f2.plannedFirst, 0) + ' km to ' + num(f2.plannedSecond, 0) + ' km on average.</li></ul>' +
        '<p class="caveat">Idling is not automatically avoidable: waiting, loading or a duty change would look the same. Suggested check: what changed for this vehicle on ' +
        dateLabel(f2.splitDay) + ' (route, duties, or a telemetry/engine issue).</p></div>');
    }
    $('findingCards').innerHTML = cards.join('') || '<div class="state">No clear anomalies found with the current thresholds.</div>';

    const li = [
      ['Duplicate telemetry rows removed (retries on the same sample_id)', q.duplicateSamples],
      ['Intervals with missing fuel (treated as unavailable, not zero)', q.missingFuel],
      ['Intervals with implausible fuel (e.g. 50 L in 5 min), fuel ignored', q.implausibleFuel],
      ['Intervals with negative distance, distance ignored', q.badDistance],
      ['Intervals with an unreliable speed field (not used; distance is)', q.badSpeedField],
      ['Rows received more than an hour after observation (kept; analysis uses observation time)', q.lateSamples],
      ['Missing 5-minute intervals within trips (' + q.tripsWithGaps + ' trips; totals slightly understated)', q.missingIntervals],
      ['Duplicate driver events removed (same event_id)', q.duplicateEvents],
      ['Events with no matching trip (excluded: no exposure to compare against)', q.unattributedEvents],
      ['Events whose vehicle differed from the trip (trip table used)', q.eventVehicleMismatch],
      ['Events with a blank driver (resolved from the trip)', q.eventDriverBlank]
    ];
    $('qList').innerHTML = li.map(x => '<li>' + esc(x[0]) + ': <strong>' + x[1] + '</strong></li>').join('') +
      '<li>Fuel efficiency (L/100 km) uses only intervals with valid fuel <em>and</em> distance: ' + num(all.fuelCoverage * 100, 1) + '% of intervals.</li>' +
      '<li>Only 8 vehicles over 2 weeks, one or two peers per group. Benchmarks are illustrative. Route, load, weather and coverage are not fully controlled. ' +
      'Event signals are detector output, and are shown per vehicle only: they do not establish driver fault.</li>';
  }

  // ---------- rendering that depends on filters ----------
  function render() {
    const f = state.filters, d = state.data;
    const sub = Fleet.filterData(d, f);
    $('empty').hidden = sub.telemetry.length > 0;
    const s = Fleet.summarise(sub.telemetry, sub.events);
    const k = (v, l, n) => '<div class="kpi"><div class="v">' + v + '</div><div class="l">' + l + '</div><div class="n">' + n + '</div></div>';
    $('kpis').innerHTML =
      k(num(s.km, 0) + ' km', 'Distance', num(s.intervals, 0) + ' valid intervals') +
      k(num(s.fuelL, 0) + ' L', 'Fuel used', 'valid fuel + distance rows only') +
      k(num(s.l100) + ' L/100 km', 'Fuel efficiency', 'coverage ' + num(s.fuelCoverage === null ? null : s.fuelCoverage * 100, 1) + '%') +
      k(num(s.idlePct) + '%', 'Idle share of engine time', num(s.idleHours) + ' idle hours') +
      k(num(s.events, 0), 'Event signals', num(s.eventsPer100, 1) + ' per 100 km');

    const rows = Fleet.byVehicle(d, f).filter(r => r.intervals > 0);
    renderCharts(rows, f);
    renderTable(rows);
  }

  function makeChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart($(id), config);
  }
  function renderCharts(rows, f) {
    const ids = rows.map(r => r.vehicleId);
    makeChart('chFuel', {
      type: 'bar',
      data: {
        labels: ids,
        datasets: [
          { label: 'Measured L/100 km', data: rows.map(r => r.l100 === null ? null : +r.l100.toFixed(2)),
            backgroundColor: rows.map(r => r.vsBenchmarkPct > 10 ? '#c2570c' : '#2f7d5b') },
          { type: 'line', label: 'Illustrative benchmark', data: rows.map(r => r.benchmark), showLine: false,
            pointStyle: 'rectRot', pointRadius: 7, pointBackgroundColor: '#14392e', borderColor: '#14392e' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: 'L/100 km' } } } }
    });
    const idle = Fleet.dailyIdle(state.data, f, ids);
    makeChart('chIdle', {
      type: 'line',
      data: {
        labels: idle.days.map(dateLabel),
        datasets: idle.series.map(sr => {
          const c = COLORS[state.data.vehicles.findIndex(v => v.vehicleId === sr.vehicleId) % COLORS.length];
          return { label: sr.vehicleId, data: sr.values, borderColor: c, backgroundColor: c, tension: 0.2, pointRadius: 2, spanGaps: true };
        })
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: '% idle' } } } }
    });
    const types = [['harsh_braking', '#2563a8'], ['harsh_acceleration', '#c2570c'], ['speeding_signal', '#8a4fb0']];
    makeChart('chEvents', {
      type: 'bar',
      data: {
        labels: ids,
        datasets: types.map(t => ({
          label: label(t[0]), backgroundColor: t[1],
          data: rows.map(r => r.km > 0 ? +(r.byType[t[0]] / r.km * 100).toFixed(2) : null)
        }))
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'signals per 100 km' } } } }
    });
  }

  const COLS = [
    ['vehicleId', 'Vehicle', r => esc(r.vehicleId)], ['vehicleClass', 'Class', r => esc(label(r.vehicleClass))],
    ['depot', 'Depot', r => esc(r.depot)], ['km', 'Distance km', r => num(r.km, 0)], ['fuelL', 'Fuel L', r => num(r.fuelL, 0)],
    ['l100', 'L/100 km', r => num(r.l100)], ['benchmark', 'Benchmark', r => num(r.benchmark, 0)],
    ['vsBenchmarkPct', 'vs benchmark', r => (r.vsBenchmarkPct > 10 ? '<span class="flag">' : '<span>') + (r.vsBenchmarkPct > 0 ? '+' : '') + num(r.vsBenchmarkPct, 0) + '%</span>'],
    ['idlePct', 'Idle %', r => num(r.idlePct)], ['events', 'Events', r => num(r.events, 0)],
    ['eventsPer100', 'Events /100 km', r => num(r.eventsPer100, 1)], ['fuelCoverage', 'Fuel data', r => num(r.fuelCoverage * 100, 0) + '%']
  ];
  function renderTable(rows) {
    const { key, dir } = state.sort;
    const sorted = [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
    });
    $('vTable').innerHTML = '<thead><tr>' + COLS.map(c => '<th data-k="' + c[0] + '">' + c[1] + (c[0] === key ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') +
      '</tr></thead><tbody>' + sorted.map(r => '<tr data-v="' + esc(r.vehicleId) + '"' + (state.filters.vehicle === r.vehicleId ? ' class="sel"' : '') + '>' +
        COLS.map(c => '<td>' + c[2](r) + '</td>').join('') + '</tr>').join('') + '</tbody>';
    $('vTable').querySelectorAll('th').forEach(th => { th.onclick = () => {
      state.sort = { key: th.dataset.k, dir: state.sort.key === th.dataset.k ? -state.sort.dir : 1 }; renderTable(rows); }; });
    $('vTable').querySelectorAll('tbody tr').forEach(tr => { tr.onclick = () => {
      const id = tr.dataset.v; state.filters.vehicle = state.filters.vehicle === id ? '' : id;
      if (state.filters.vehicle) { state.filters.cls = ''; $('fClass').value = ''; refreshVehicleOptions(); }
      $('fVehicle').value = state.filters.vehicle; render(); }; });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
