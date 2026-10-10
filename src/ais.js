'use strict';

// Normalises AISStream messages into plain objects the rest of the app uses.
// Pure functions only: no I/O, so they are easy to test.

const SHIP_CATEGORIES = [
  [[30, 30], 'Fishing'],
  [[31, 32], 'Towing'],
  [[35, 35], 'Military'],
  [[36, 36], 'Sailing'],
  [[37, 37], 'Pleasure craft'],
  [[40, 49], 'High-speed craft'],
  [[50, 50], 'Pilot'],
  [[51, 51], 'Search and rescue'],
  [[52, 52], 'Tug'],
  [[53, 59], 'Port / special service'],
  [[60, 69], 'Passenger'],
  [[70, 79], 'Cargo'],
  [[80, 89], 'Tanker'],
];

const POSITION_TYPES = new Set([
  'PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport',
]);

function shipCategory(typeCode) {
  const code = Number(typeCode);
  if (!Number.isInteger(code) || code <= 0) return 'Unknown';
  for (const [[from, to], label] of SHIP_CATEGORIES) {
    if (code >= from && code <= to) return label;
  }
  return 'Other';
}

// AISStream sends "2026-10-10 11:22:33.123456789 +0000 UTC"; convert to ISO.
function parseAisTime(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/);
  if (!m) return null;
  const ms = m[3] ? m[3].slice(0, 4) : '';
  const d = new Date(`${m[1]}T${m[2]}${ms}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function cleanText(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/@+$/g, '').trim();
  return s.length ? s : null;
}

function validCoord(lat, lon) {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

// Field names differ in case between AISStream docs and live data, so read both.
function meta(raw) {
  const m = raw.MetaData || {};
  return {
    mmsi: Number(m.MMSI ?? m.mmsi),
    name: cleanText(m.ShipName ?? m.shipName),
    lat: Number(m.latitude ?? m.Latitude),
    lon: Number(m.longitude ?? m.Longitude),
    time: parseAisTime(m.time_utc ?? m.TimeUtc),
  };
}

/**
 * Turns one raw AISStream message into
 *   { kind: 'position', mmsi, name, lat, lon, sog, cog, heading, navStatus, time }
 *   { kind: 'static', mmsi, name, imo, callSign, shipType, category, destination, length }
 * or null when the message is not usable.
 */
function normalize(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.MessageType;
  const m = meta(raw);
  if (!Number.isInteger(m.mmsi) || m.mmsi < 100000000 || m.mmsi > 999999999) return null;
  const time = m.time || now.toISOString();

  if (POSITION_TYPES.has(type)) {
    const p = (raw.Message || {})[type] || {};
    if (p.Valid === false) return null;
    const lat = Number(p.Latitude ?? m.lat);
    const lon = Number(p.Longitude ?? m.lon);
    if (!validCoord(lat, lon)) return null;
    const sog = Number(p.Sog);
    const cog = Number(p.Cog);
    const heading = Number(p.TrueHeading);
    return {
      kind: 'position',
      mmsi: m.mmsi,
      name: m.name,
      lat,
      lon,
      sog: Number.isFinite(sog) && sog < 102.3 ? sog : null,
      cog: Number.isFinite(cog) && cog < 360 ? cog : null,
      heading: Number.isFinite(heading) && heading < 360 ? heading : null,
      navStatus: Number.isInteger(p.NavigationalStatus) ? p.NavigationalStatus : null,
      time,
    };
  }

  if (type === 'ShipStaticData') {
    const s = (raw.Message || {}).ShipStaticData || {};
    if (s.Valid === false) return null;
    const dim = s.Dimension || {};
    const length = Number(dim.A) + Number(dim.B);
    const imo = Number(s.ImoNumber);
    return {
      kind: 'static',
      mmsi: m.mmsi,
      name: cleanText(s.Name) || m.name,
      imo: Number.isInteger(imo) && imo > 0 ? imo : null,
      callSign: cleanText(s.CallSign),
      shipType: Number.isInteger(s.Type) ? s.Type : null,
      category: shipCategory(s.Type),
      destination: cleanText(s.Destination),
      length: Number.isFinite(length) && length > 0 ? length : null,
      time,
    };
  }

  // Class B transponders (mostly yachts and small craft) send their details in
  // message 24, split into part A (name) and part B (type, call sign, size).
  if (type === 'StaticDataReport') {
    const s = (raw.Message || {}).StaticDataReport || {};
    if (s.Valid === false) return null;
    const a = s.ReportA || {};
    const b = s.ReportB || {};
    const empty = {
      kind: 'static', mmsi: m.mmsi, name: m.name, imo: null, callSign: null, shipType: null,
      category: 'Unknown', destination: null, length: null, time,
    };
    if (a.Valid) {
      return { ...empty, name: cleanText(a.Name) || m.name };
    }
    if (b.Valid) {
      const dim = b.Dimension || {};
      const length = Number(dim.A) + Number(dim.B);
      return {
        ...empty,
        callSign: cleanText(b.CallSign),
        shipType: Number.isInteger(b.ShipType) ? b.ShipType : null,
        category: shipCategory(b.ShipType),
        length: Number.isFinite(length) && length > 0 ? length : null,
      };
    }
    return null;
  }

  return null;
}

module.exports = { normalize, shipCategory, parseAisTime };
