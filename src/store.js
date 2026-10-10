'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vessels (
  mmsi          INTEGER PRIMARY KEY,
  name          TEXT,
  imo           INTEGER,
  call_sign     TEXT,
  ship_type     INTEGER,
  category      TEXT NOT NULL DEFAULT 'Unknown',
  destination   TEXT,
  length        REAL,
  lat           REAL,
  lon           REAL,
  sog           REAL,
  cog           REAL,
  heading       REAL,
  nav_status    INTEGER,
  last_seen     TEXT,
  last_track_at TEXT
);

CREATE TABLE IF NOT EXISTS positions (
  id    INTEGER PRIMARY KEY,
  mmsi  INTEGER NOT NULL,
  lat   REAL NOT NULL,
  lon   REAL NOT NULL,
  sog   REAL,
  cog   REAL,
  time  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_positions_mmsi_time ON positions (mmsi, time);

CREATE TABLE IF NOT EXISTS port_calls (
  id        INTEGER PRIMARY KEY,
  mmsi      INTEGER NOT NULL,
  arrival   TEXT NOT NULL,
  departure TEXT,
  -- 0 when the vessel was already berthed the first time we saw it, so the
  -- real arrival time is unknown; such calls are left out of arrival counts
  -- and dwell times.
  arrival_known INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_port_calls_arrival ON port_calls (arrival);
CREATE INDEX IF NOT EXISTS idx_port_calls_open ON port_calls (mmsi) WHERE departure IS NULL;
`;

// Calls shorter than this are treated as noise in the dwell-time statistics.
const MIN_CALL_MINUTES = 10;

// Harbour craft that move around the port all day are left out of port-call
// statistics; they are still shown on the map.
const SERVICE_CATEGORIES = [
  'Tug', 'Pilot', 'Port / special service', 'Search and rescue', 'Towing',
  'Military', 'Sailing', 'Pleasure craft', 'Fishing',
];
const NOT_SERVICE = `COALESCE(v.category, 'Unknown') NOT IN (${SERVICE_CATEGORIES.map((c) => `'${c}'`).join(', ')})`;

function isoMinus(now, ms) {
  return new Date(now.getTime() - ms).toISOString();
}

class Store {
  constructor(dbPath) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    // Safe with WAL and much faster on Windows, where every sync is expensive.
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
    this.migrate();
    this.prepare();
  }

  // Adds columns introduced after a database was first created.
  migrate() {
    const cols = this.db.prepare('PRAGMA table_info(port_calls)').all().map((c) => c.name);
    if (!cols.includes('arrival_known')) {
      this.db.exec('ALTER TABLE port_calls ADD COLUMN arrival_known INTEGER NOT NULL DEFAULT 1');
      // Calls recorded before this column existed may include vessels that were
      // already berthed at start-up, so their arrival times cannot be trusted.
      this.db.exec('UPDATE port_calls SET arrival_known = 0');
    }
  }

  prepare() {
    const q = (sql) => this.db.prepare(sql);
    this.sql = {
      upsertPosition: q(`
        INSERT INTO vessels (mmsi, name, lat, lon, sog, cog, heading, nav_status, last_seen)
        VALUES (:mmsi, :name, :lat, :lon, :sog, :cog, :heading, :navStatus, :time)
        ON CONFLICT (mmsi) DO UPDATE SET
          name = COALESCE(vessels.name, excluded.name),
          lat = excluded.lat, lon = excluded.lon, sog = excluded.sog, cog = excluded.cog,
          heading = excluded.heading, nav_status = excluded.nav_status,
          last_seen = excluded.last_seen
        WHERE vessels.last_seen IS NULL OR excluded.last_seen >= vessels.last_seen`),
      upsertStatic: q(`
        INSERT INTO vessels (mmsi, name, imo, call_sign, ship_type, category, destination, length)
        VALUES (:mmsi, :name, :imo, :callSign, :shipType, :category, :destination, :length)
        ON CONFLICT (mmsi) DO UPDATE SET
          name = COALESCE(excluded.name, vessels.name),
          imo = COALESCE(excluded.imo, vessels.imo),
          call_sign = COALESCE(excluded.call_sign, vessels.call_sign),
          ship_type = COALESCE(excluded.ship_type, vessels.ship_type),
          category = CASE WHEN excluded.category = 'Unknown' THEN vessels.category
                          ELSE excluded.category END,
          destination = COALESCE(excluded.destination, vessels.destination),
          length = COALESCE(excluded.length, vessels.length)`),
      lastTrackAt: q('SELECT last_track_at FROM vessels WHERE mmsi = ?'),
      lastSeen: q('SELECT last_seen FROM vessels WHERE mmsi = ?'),
      setLastTrackAt: q('UPDATE vessels SET last_track_at = ? WHERE mmsi = ?'),
      insertPosition: q(`
        INSERT INTO positions (mmsi, lat, lon, sog, cog, time)
        VALUES (:mmsi, :lat, :lon, :sog, :cog, :time)`),
      openCall: q('INSERT INTO port_calls (mmsi, arrival, arrival_known) VALUES (?, ?, ?)'),
      closeCall: q('UPDATE port_calls SET departure = ? WHERE mmsi = ? AND departure IS NULL'),
      openCalls: q('SELECT mmsi, arrival FROM port_calls WHERE departure IS NULL'),
      prune: q('DELETE FROM positions WHERE time < ?'),
    };
  }

  // --- writes -------------------------------------------------------------

  /** Runs fn inside one transaction (used for bulk loads). */
  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  savePosition(p, trackIntervalSec) {
    this.sql.upsertPosition.run({
      mmsi: p.mmsi, name: p.name, lat: p.lat, lon: p.lon, sog: p.sog,
      cog: p.cog, heading: p.heading, navStatus: p.navStatus, time: p.time,
    });
    const row = this.sql.lastTrackAt.get(p.mmsi);
    const last = row && row.last_track_at ? Date.parse(row.last_track_at) : 0;
    if (Date.parse(p.time) - last >= trackIntervalSec * 1000) {
      this.sql.insertPosition.run({
        mmsi: p.mmsi, lat: p.lat, lon: p.lon, sog: p.sog, cog: p.cog, time: p.time,
      });
      this.sql.setLastTrackAt.run(p.time, p.mmsi);
    }
  }

  saveStatic(s) {
    this.sql.upsertStatic.run({
      mmsi: s.mmsi, name: s.name, imo: s.imo, callSign: s.callSign, shipType: s.shipType,
      category: s.category, destination: s.destination, length: s.length,
    });
  }

  saveEvent(event) {
    if (event.type === 'arrival') {
      this.sql.openCall.run(event.mmsi, event.time, event.arrivalKnown === false ? 0 : 1);
    }
    else if (event.type === 'departure') this.sql.closeCall.run(event.time, event.mmsi);
  }

  /** ISO time the vessel was last heard from, or null for a new vessel. */
  lastSeen(mmsi) {
    const row = this.sql.lastSeen.get(mmsi);
    return row ? row.last_seen : null;
  }

  loadOpenCalls() {
    return this.sql.openCalls.all().map((r) => ({ mmsi: r.mmsi, arrival: r.arrival }));
  }

  prune(retentionDays, now = new Date()) {
    return this.sql.prune.run(isoMinus(now, retentionDays * 86400000)).changes;
  }

  // --- reads --------------------------------------------------------------

  liveVessels(windowMin, now = new Date()) {
    return this.db.prepare(`
      SELECT v.mmsi, v.name, v.imo, v.call_sign AS callSign, v.category, v.destination,
             v.length, v.lat, v.lon, v.sog, v.cog, v.heading, v.last_seen AS lastSeen,
             (pc.id IS NOT NULL) AS inPort
      FROM vessels v
      LEFT JOIN port_calls pc ON pc.mmsi = v.mmsi AND pc.departure IS NULL
      WHERE v.last_seen >= ? AND v.lat IS NOT NULL
      ORDER BY v.last_seen DESC`).all(isoMinus(now, windowMin * 60000))
      .map((r) => ({ ...r, inPort: Boolean(r.inPort) }));
  }

  track(mmsi, hours = 6, now = new Date()) {
    return this.db.prepare(`
      SELECT lat, lon, sog, time FROM positions
      WHERE mmsi = ? AND time >= ? ORDER BY time`).all(mmsi, isoMinus(now, hours * 3600000));
  }

  stats(windowMin, now = new Date()) {
    const dayAgo = isoMinus(now, 86400000);
    const weekAgo = isoMinus(now, 7 * 86400000);
    const one = (sql, ...args) => this.db.prepare(sql).get(...args);
    const all = (sql, ...args) => this.db.prepare(sql).all(...args);
    const dwellMin = '(julianday(pc.departure) - julianday(pc.arrival)) * 1440';
    const calls = `FROM port_calls pc LEFT JOIN vessels v ON v.mmsi = pc.mmsi WHERE ${NOT_SERVICE}`;

    return {
      generatedAt: now.toISOString(),
      liveVessels: one('SELECT COUNT(*) AS n FROM vessels WHERE last_seen >= ?',
        isoMinus(now, windowMin * 60000)).n,
      inPortNow: one(`SELECT COUNT(*) AS n ${calls} AND pc.departure IS NULL`).n,
      arrivals24h: one(`SELECT COUNT(*) AS n ${calls} AND pc.arrival_known = 1 AND pc.arrival >= ?`, dayAgo).n,
      departures24h: one(`SELECT COUNT(*) AS n ${calls} AND pc.departure >= ?`, dayAgo).n,
      dwellByCategory: all(`
        SELECT v.category, COUNT(*) AS calls, ROUND(AVG(${dwellMin})) AS avgDwellMin
        ${calls} AND pc.arrival_known = 1 AND pc.departure IS NOT NULL AND pc.arrival >= ?
          AND ${dwellMin} >= ?
        GROUP BY v.category ORDER BY calls DESC`, weekAgo, MIN_CALL_MINUTES),
      liveByCategory: all(`
        SELECT category, COUNT(*) AS vessels FROM vessels
        WHERE last_seen >= ? GROUP BY category ORDER BY vessels DESC`,
        isoMinus(now, windowMin * 60000)),
      recentCalls: all(`
        SELECT pc.mmsi, v.name, v.category, pc.arrival, pc.departure,
               (pc.arrival_known = 1) AS arrivalKnown,
               CASE WHEN pc.departure IS NULL OR pc.arrival_known = 0 THEN NULL
                    ELSE ROUND(${dwellMin}) END AS dwellMin
        ${calls} ORDER BY COALESCE(pc.departure, pc.arrival) DESC LIMIT 15`),
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = { Store, MIN_CALL_MINUTES, SERVICE_CATEGORIES };
