// Node check: node check.js  (runs cleaning.js on the CSVs and prints counts + one trip)
const fs = require('fs'); const F = require('./cleaning.js');
const csv = n => { const [h, ...l] = fs.readFileSync('data/' + n + '.csv', 'utf8').trim().split(/\r?\n/);
  const k = h.split(','); return l.map(x => Object.fromEntries(x.split(',').map((v, i) => [k[i], v]))); };
const d = F.cleanAll({ vehicles: csv('vehicles'), drivers: csv('drivers'), trips: csv('trips'),
  telemetry: csv('telemetry_samples'), events: csv('driver_events') });
console.log(d.quality);
for (const id of process.argv[2] ? [process.argv[2]] : ['TRP0001', 'TRP0114', 'TRP0010']) {
  const t = F.getTrip(d, id); if (!t) { console.log(id, 'not found'); continue; }
  console.log(id, t.vehicle.vehicleId, 'samples', t.samples.length, 'missing intervals', t.trip.missingIntervals,
    'dups removed', t.trip.duplicatesRemoved, 'events', t.events.length);
  console.table(t.samples.slice(0, 20).map(s => ({ seq: s.seq, t: new Date(s.time).toISOString().slice(11, 16), km: s.km, cumulKm: s.cumulKm,
    fuel: s.fuelL, cumulFuel: s.cumulFuelL, idle: s.idleS, cumulIdle: s.cumulIdleS, gap: s.gapBefore, fuelPartial: s.cumulFuelPartial })));
}
// consistency: last cumulative value equals the sum of the increments
let bad = 0;
d.telemetryByTrip.forEach(rows => {
  const sk = rows.reduce((a, r) => a + (r.km || 0), 0), sf = rows.reduce((a, r) => a + (r.fuelL || 0), 0);
  const last = rows[rows.length - 1];
  if (Math.abs(last.cumulKm - sk) > 1e-3 || Math.abs(last.cumulFuelL - sf) > 1e-3) bad++;
});
console.log('trips where cumulative != sum of increments:', bad, '| unknown trip lookup:', F.getTrip(d, 'NOPE'));
