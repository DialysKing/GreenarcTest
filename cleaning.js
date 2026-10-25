/* cleaning.js - validation, cleaning and per-trip cumulative columns. No DOM code, no analysis.
 * Every assumption lives in RULES so it is easy to change. */
(function (root) {
  'use strict';

  const RULES = {
    INTERVAL_S: 300,                // expected telemetry interval (data dictionary)
    MAX_FUEL_L_PER_INTERVAL: 10,    // real values are ~0.1-2.5 L; 50.0 looks like a placeholder
    MAX_SPEED_KPH: 150,
    SPEED_TOLERANCE_KPH: 0.5,       // reported speed vs distance / time
    LATE_RECEIPT_S: 3600,           // count rows ingested >1h after observation
    GAP_FACTOR: 1.5,                // gap flagged if spacing > 1.5 x interval
    EXTRACT_AS_OF: '2026-10-20T00:00:00Z',
    DECIMALS: 4                     // rounding for cumulative sums (avoids 0.30000000000000004)
  };

  // Metrics a chart can show. key = incremental column, cumKey = cumulative column.
  // "Time" is engine-on seconds; idle seconds are a subset of it (data dictionary).
  const METRICS = [
    { id: 'distance', label: 'Distance',        unit: 'km',      key: 'km',      cumKey: 'cumKm',      partialKey: 'cumKmPartial' },
    { id: 'fuel',     label: 'Fuel used',       unit: 'L',       key: 'fuelL',   cumKey: 'cumFuelL',   partialKey: 'cumFuelPartial' },
    { id: 'idle',     label: 'Idle time',       unit: 'seconds', key: 'idleS',   cumKey: 'cumIdleS',   partialKey: 'cumIdlePartial' },
    { id: 'engine',   label: 'Engine-on time',  unit: 'seconds', key: 'engineS', cumKey: 'cumEngineS', partialKey: 'cumIdlePartial' }
  ];

  // ---------- small helpers ----------
  function toNumber(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null; // blank = unavailable, not zero
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  // ISO 8601 -> epoch ms. Respects explicit offsets; no offset = UTC. Rounded to the second
  // (some values arrive as 07:34:59.999).
  function toTime(v) {
    if (!v) return null;
    let s = String(v).trim().replace(' ', 'T');
    if (!/T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : Math.round(ms / 1000) * 1000;
  }
  const dayKey = ms => new Date(ms).toISOString().slice(0, 10);
  const round = n => Number(n.toFixed(RULES.DECIMALS));

  // ---------- cleaning ----------
  // raw = { vehicles, drivers, trips, telemetry, events } (arrays of plain objects). Not mutated.
  function cleanAll(raw) {
    const q = {
      telemetryRows: raw.telemetry.length, eventRows: raw.events.length,
      duplicateSamples: 0, orphanSamples: 0, badTime: 0, lateSamples: 0, afterExtract: 0,
      badDistance: 0, missingFuel: 0, implausibleFuel: 0, badIdle: 0, badSpeedField: 0,
      missingIntervals: 0, tripsWithGaps: 0,
      duplicateEvents: 0, unattributedEvents: 0, eventVehicleMismatch: 0, eventDriverBlank: 0,
      eventDriverMismatch: 0, unknownEventCategory: 0
    };

    const vehicles = raw.vehicles.map(v => ({
      vehicleId: v.vehicle_id, vehicleClass: v.vehicle_class, depot: v.depot,
      benchmark: toNumber(v.illustrative_benchmark_l_per_100km)
    }));
    const vehById = new Map(vehicles.map(v => [v.vehicleId, v]));
    const drivers = raw.drivers.map(d => ({ driverId: d.driver_id, name: d.display_name }));

    const trips = [];
    raw.trips.forEach(t => {
      const start = toTime(t.start_time_utc), end = toTime(t.end_time_utc);
      if (start === null || end === null || !vehById.has(t.vehicle_id)) return;
      trips.push({
        tripId: String(t.trip_id).trim().toUpperCase(), vehicleId: t.vehicle_id, driverId: t.driver_id, start, end,
        day: dayKey(start), route: t.route_type, load: t.load_band, weather: t.weather,
        plannedKm: toNumber(t.planned_distance_km),
        expectedIntervals: Math.round((end - start) / 1000 / RULES.INTERVAL_S),
        // per-trip data-quality counters, filled in below so the UI can show them next to the chart
        samples: 0, duplicatesRemoved: 0, missingIntervals: 0,
        missingFuel: 0, implausibleFuel: 0, invalidDistance: 0
      });
    });
    const tripById = new Map(trips.map(t => [t.tripId, t]));
    const tripOf = id => tripById.get(String(id).trim().toUpperCase());

    // Telemetry: oldest-received first so a retry never replaces the original; dedupe on sample_id.
    const sorted = [...raw.telemetry].sort((a, b) => (toTime(a.received_time_utc) || 0) - (toTime(b.received_time_utc) || 0));
    const seen = new Set(), telemetry = [];
    const asOf = Date.parse(RULES.EXTRACT_AS_OF);
    sorted.forEach(r => {
      const trip = tripOf(r.trip_id);
      if (seen.has(r.sample_id)) { q.duplicateSamples++; if (trip) trip.duplicatesRemoved++; return; }
      seen.add(r.sample_id);
      if (!trip) { q.orphanSamples++; return; }
      const t = toTime(r.event_time_utc), recv = toTime(r.received_time_utc);
      if (t === null) { q.badTime++; return; }
      if (recv !== null && recv > asOf) { q.afterExtract++; return; }
      if (recv !== null && (recv - t) / 1000 > RULES.LATE_RECEIPT_S) q.lateSamples++; // kept: observation time is used

      const interval = toNumber(r.interval_seconds) || RULES.INTERVAL_S;
      let dist = toNumber(r.distance_km);
      if (dist === null || dist < 0) { q.badDistance++; trip.invalidDistance++; dist = null; }
      let fuel = toNumber(r.fuel_used_l);
      if (fuel === null) { q.missingFuel++; trip.missingFuel++; }
      else if (fuel < 0 || fuel > RULES.MAX_FUEL_L_PER_INTERVAL) { q.implausibleFuel++; trip.implausibleFuel++; fuel = null; }
      let engine = toNumber(r.engine_on_seconds), idle = toNumber(r.idle_seconds);
      if (engine === null || idle === null || idle > engine || engine > interval) { q.badIdle++; engine = null; idle = null; }
      const speed = toNumber(r.average_speed_kph);
      if (dist !== null && speed !== null &&
          (Math.abs(speed - dist / (interval / 3600)) > RULES.SPEED_TOLERANCE_KPH || speed > RULES.MAX_SPEED_KPH)) {
        q.badSpeedField++; // informational: speed is not used, distance is
      }
      trip.samples++;
      telemetry.push({
        sampleId: r.sample_id, tripId: trip.tripId, vehicleId: trip.vehicleId, driverId: trip.driverId,
        route: trip.route, load: trip.load, time: t, day: dayKey(t), intervalS: interval,
        km: dist, fuelL: fuel, engineS: engine, idleS: idle   // null = unavailable (never 0)
      });
    });

    // Group by trip, order by observation time, add sequence, gap flag and cumulative columns.
    // A null increment adds nothing to the running total and marks it "Partial" from then on,
    // so a cumulative line can be shown as a lower bound rather than silently understated.
    const telemetryByTrip = new Map();
    telemetry.forEach(r => {
      if (!telemetryByTrip.has(r.tripId)) telemetryByTrip.set(r.tripId, []);
      telemetryByTrip.get(r.tripId).push(r);
    });
    telemetryByTrip.forEach((rows, id) => {
      const trip = tripById.get(id);
      rows.sort((a, b) => a.time - b.time);
      let km = 0, fuel = 0, idle = 0, engine = 0, kmP = false, fuelP = false, idleP = false;
      rows.forEach((r, i) => {
        const prevTime = i === 0 ? trip.start : rows[i - 1].time;
        r.seq = i + 1;
        r.gapBefore = (r.time - prevTime) > RULES.GAP_FACTOR * r.intervalS * 1000; // missing interval(s) before this sample
        if (r.km === null) kmP = true; else km += r.km;
        if (r.fuelL === null) fuelP = true; else fuel += r.fuelL;
        if (r.idleS === null) idleP = true; else { idle += r.idleS; engine += r.engineS; }
        r.cumKm = round(km); r.cumFuelL = round(fuel); r.cumIdleS = round(idle); r.cumEngineS = round(engine);
        r.cumKmPartial = kmP; r.cumFuelPartial = fuelP; r.cumIdlePartial = idleP;
      });
      trip.missingIntervals = Math.max(0, trip.expectedIntervals - rows.length);
      if (trip.missingIntervals > 0) { q.missingIntervals += trip.missingIntervals; q.tripsWithGaps++; }
    });
    // trips with no usable telemetry at all
    trips.forEach(t => {
      if (!telemetryByTrip.has(t.tripId) && t.expectedIntervals > 0) {
        t.missingIntervals = t.expectedIntervals; q.missingIntervals += t.expectedIntervals; q.tripsWithGaps++;
      }
    });

    // Events: dedupe on event_id; the trip table is the authority for vehicle, driver and route.
    const seenE = new Set(), events = [];
    raw.events.forEach(e => {
      if (seenE.has(e.event_id)) { q.duplicateEvents++; return; }
      seenE.add(e.event_id);
      const type = String(e.event_type || '').trim().toLowerCase();
      const sev = String(e.detector_severity || '').trim().toLowerCase();
      if (!['harsh_braking', 'harsh_acceleration', 'speeding_signal'].includes(type) ||
          !['low', 'medium', 'high'].includes(sev)) q.unknownEventCategory++;
      const trip = tripOf(e.trip_id);
      const t = toTime(e.event_time_utc);
      if (!trip || t === null) { q.unattributedEvents++; return; } // no trip = cannot be placed on a trip chart
      if (e.vehicle_id !== trip.vehicleId) q.eventVehicleMismatch++;
      if (!e.driver_id) q.eventDriverBlank++;
      else if (e.driver_id !== trip.driverId) q.eventDriverMismatch++;
      events.push({
        eventId: e.event_id, tripId: trip.tripId, vehicleId: trip.vehicleId, driverId: trip.driverId,
        route: trip.route, time: t, day: dayKey(t), type, severity: sev
      });
    });
    events.sort((a, b) => a.time - b.time);

    return {
      vehicles, drivers, trips, telemetry, events, quality: q,
      vehById, tripById, telemetryByTrip,
      tripIds: trips.map(t => t.tripId).sort()   // for the trip dropdown / validation
    };
  }

  // Look up one trip for the analyser. Returns null if the ID is not in the data.
  // samples are time-ordered and already carry the cumulative columns.
  function getTrip(data, tripId) {
    const id = String(tripId || '').trim().toUpperCase();
    const trip = data.tripById.get(id);
    if (!trip) return null;
    return {
      trip, vehicle: data.vehById.get(trip.vehicleId),
      samples: data.telemetryByTrip.get(id) || [],
      events: data.events.filter(e => e.tripId === id)
    };
  }

  const api = { RULES, METRICS, toNumber, toTime, cleanAll, getTrip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // for the Node check
  root.Fleet = api;
})(typeof window !== 'undefined' ? window : globalThis);
