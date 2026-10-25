/* app.js - trip analyser: load CSVs, clean once (cleaning.js), draw one trip with Highcharts. */
(function () {
  'use strict';

  // Add a CSV here to load it. Paths are relative so GitHub Pages project sites work.
  const DATA_FILES = {
    vehicles: 'data/vehicles.csv', drivers: 'data/drivers.csv', trips: 'data/trips.csv',
    telemetry: 'data/telemetry_samples.csv', events: 'data/driver_events.csv'
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const label = s => String(s).replace(/_/g, ' ');
  const num = (x, d = 2) => (x === null || x === undefined) ? 'unavailable' : Number(x).toLocaleString('en-GB', { maximumFractionDigits: d });
  const hhmm = ms => new Date(ms).toISOString().slice(11, 16);
  let data = null, current = null;
  const ORANGE = '#c2570c', GREEN = '#2f7d5b';

  function loadCsv(url) {
    return new Promise((resolve, reject) => {
      Papa.parse(url, {
        download: true, header: true, skipEmptyLines: true,
        complete: res => res.data.length ? resolve(res.data) : reject(new Error(url + ' is empty')),
        error: err => reject(new Error('Could not load ' + url + ' (' + (err && err.message || err) + ')'))
      });
    });
  }

  async function init() {
    try {
      const missing = [];
      if (typeof Papa === 'undefined') missing.push('Papa Parse');
      if (typeof Highcharts === 'undefined') missing.push('Highcharts');
      if (missing.length) throw new Error('Not loaded: ' + missing.join(', ') + '. index.html must be the latest version (it needs the Highcharts script tag, not Chart.js), and you must be online.');
      if (!$('tripInput')) throw new Error('index.html is out of date: it does not match this app.js. Replace it with the latest index.html.');
      const keys = Object.keys(DATA_FILES);
      const loaded = await Promise.all(keys.map(k => loadCsv(DATA_FILES[k])));
      const raw = {}; keys.forEach((k, i) => { raw[k] = loaded[i]; });
      data = Fleet.cleanAll(raw);                      // cleaned once, reused for every trip
      if (!data.tripIds.length) throw new Error('No usable trips after cleaning.');
      $('loading').hidden = true; $('app').hidden = false;

      $('tripList').innerHTML = data.tripIds.map(id => '<option value="' + esc(id) + '">').join('');
      $('metric').innerHTML = Fleet.METRICS.map(m => '<option value="' + m.id + '">' + esc(m.label) + ' (' + m.unit + ')</option>').join('');
      $('loadBtn').onclick = () => show($('tripInput').value);
      $('tripInput').onkeydown = e => { if (e.key === 'Enter') show(e.target.value); };
      ['metric', 'cum', 'showEvents'].forEach(id => { $(id).onchange = draw; });
      window.addEventListener('hashchange', fromHash);
      fromHash() || show(data.tripIds[0]);
    } catch (err) {
      $('loading').hidden = true;
      $('error').hidden = false;
      $('error').innerHTML = '<strong>The data could not be loaded.</strong><br>' + esc(err.message) +
        '<pre style="white-space:pre-wrap;font-size:11px;margin:8px 0 0">' + esc(String(err.stack || '').split('\n').slice(0, 4).join('\n')) + '</pre>' +
        '<br><small>If you opened index.html directly from disk, run a local web server instead (see README).</small>';
    }
  }
  function fromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return false;
    show(id); return true;
  }

  function show(id) {
    const clean = String(id || '').trim().toUpperCase();
    $('tripInput').value = clean;
    current = Fleet.getTrip(data, clean);
    $('tripError').hidden = !!current; $('tripView').hidden = !current;
    if (!current) {
      $('tripError').textContent = clean ? 'Trip "' + clean + '" was not found. Try one from the list (e.g. ' + data.tripIds[0] + ').' : 'Enter a trip ID.';
      return;
    }
    history.replaceState(null, '', '#' + clean);
    renderMeta();
    draw();
  }

  function renderMeta() {
    const { trip, vehicle, samples } = current;
    const f = (k, v) => '<div><span>' + k + '</span>' + esc(v) + '</div>';
    $('meta').innerHTML =
      f('Trip', trip.tripId) + f('Vehicle', trip.vehicleId + ' (' + label(vehicle.vehicleClass) + ')') + f('Depot', vehicle.depot) +
      f('Driver', trip.driverId) + f('Route / load / weather', trip.route + ' / ' + trip.load + ' / ' + trip.weather) +
      f('Start – end (UTC)', trip.day + ' ' + hhmm(trip.start) + '–' + hhmm(trip.end)) +
      f('Samples', samples.length + ' of ' + trip.expectedIntervals + ' expected');
    const notes = [];
    if (trip.missingIntervals) notes.push(trip.missingIntervals + ' missing 5-minute interval(s)');
    if (trip.duplicatesRemoved) notes.push(trip.duplicatesRemoved + ' duplicate row(s) removed');
    if (trip.missingFuel + trip.implausibleFuel) notes.push((trip.missingFuel + trip.implausibleFuel) + ' fuel reading(s) missing or implausible');
    if (trip.invalidDistance) notes.push(trip.invalidDistance + ' invalid distance reading(s)');
    $('quality').innerHTML = notes.length ? '<strong>Data quality for this trip:</strong> ' + notes.join('; ') + '.'
      : '<strong>Data quality for this trip:</strong> no issues found.';
  }

  function draw() {
    if (!current) return;
    const m = Fleet.METRICS.find(x => x.id === $('metric').value) || Fleet.METRICS[0];
    const cum = $('cum').checked;
    const { trip, samples, events } = current;
    const key = cum ? m.cumKey : m.key;

    const points = samples.map(s => {
      const partial = cum && s[m.partialKey];
      const p = { x: s.time, y: s[key], custom: { seq: s.seq, inc: s[m.key], cum: s[m.cumKey], partial, gap: s.gapBefore } };
      if (partial || s.gapBefore) p.marker = { fillColor: partial ? '#fff' : ORANGE, lineColor: ORANGE, lineWidth: 2, radius: 5 };
      return p;
    });

    const plotLines = $('showEvents').checked ? events.map(e => ({
      value: e.time, color: '#8a4fb0', dashStyle: 'Dash', width: 1, zIndex: 3,
      label: { text: label(e.type) + ' (' + e.severity + ')', rotation: 270, align: 'left', x: 2, style: { fontSize: '10px', color: '#8a4fb0' } }
    })) : [];

    try { Highcharts.chart('chart', {
      chart: { type: 'line', zoomType: 'x' },
      time: { useUTC: true },
      credits: { enabled: false },
      title: { text: trip.tripId + ' – ' + m.label + (cum ? ' (cumulative)' : ' (per sample)'), style: { fontSize: '15px' } },
      xAxis: { type: 'datetime', title: { text: 'Time (UTC)' }, plotLines },
      yAxis: { title: { text: m.label + ' (' + m.unit + ')' }, min: 0 },
      legend: { enabled: false },
      plotOptions: { series: { color: GREEN, marker: { enabled: true, radius: 4 }, connectNulls: false } },
      tooltip: {
        formatter: function () {
          const c = this.point.options.custom;
          let h = '<b>' + hhmm(this.x) + ' UTC</b> &middot; sample ' + c.seq + ' of ' + samples.length + '<br>' +
            m.label + ' this interval: <b>' + num(c.inc) + ' ' + m.unit + '</b><br>' +
            m.label + ' cumulative: <b>' + num(c.cum) + ' ' + m.unit + '</b>';
          if (c.inc === null) h += '<br><i>Reading unavailable (not zero)</i>';
          if (c.partial) h += '<br><i>Cumulative is a lower bound: an earlier reading was unavailable</i>';
          if (c.gap) h += '<br><i>One or more samples are missing before this point</i>';
          return h;
        }
      },
      series: [{ name: m.label, data: points }]
    }); $('tripError').hidden = true;
    } catch (err) {
      console.error(err);
      $('tripError').hidden = false;
      $('tripError').innerHTML = '<strong>The chart could not be drawn.</strong> ' + esc(err.message) +
        '<pre style="white-space:pre-wrap;font-size:11px">' + esc(String(err.stack || '').split('\n').slice(0, 4).join('\n')) + '</pre>';
    }

    const hasPartial = cum && samples.some(s => s[m.partialKey]);
    const hasGap = samples.some(s => s.gapBefore);
    $('chartNote').textContent =
      (hasPartial ? 'Hollow orange points: the running total is a lower bound because an earlier reading was unavailable. ' : '') +
      (hasGap ? 'Filled orange points: samples are missing just before this point. ' : '') +
      (!cum && samples.some(s => s[key] === null) ? 'Gaps in the line are unavailable readings. ' : '') +
      'Drag on the chart to zoom.';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
