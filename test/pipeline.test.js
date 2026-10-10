'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { PortCallDetector } = require('../src/portcalls');
const { createPipeline } = require('../src/pipeline');
const { positionMessage, FLEET } = require('../src/demo');
const config = require('../src/config');

function setup() {
  const store = new Store(':memory:');
  const detector = new PortCallDetector(
    { polygon: config.portPolygon, berthSpeedKnots: config.berthSpeedKnots },
  );
  const pipeline = createPipeline({ store, detector, config });
  return { store, pipeline };
}

function staticMsg(mmsi, type) {
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: mmsi, ShipName: 'X' },
    Message: { ShipStaticData: { Valid: true, Name: 'X', Type: type } },
  };
}

function pos(mmsi, lat, lon, sog, iso) {
  return {
    MessageType: 'PositionReport',
    MetaData: { MMSI: mmsi, ShipName: 'X', latitude: lat, longitude: lon,
      time_utc: `${iso.replace('T', ' ').replace('Z', '')} +0000 UTC` },
    Message: { PositionReport: { Valid: true, Latitude: lat, Longitude: lon, Sog: sog, Cog: 10 } },
  };
}

test('records a complete port call and reports it in the statistics', () => {
  const { store, pipeline } = setup();
  const now = new Date();
  const t = (min) => new Date(now.getTime() - min * 60000).toISOString();

  pipeline.handle(staticMsg(239000001, 70));
  pipeline.handle(pos(239000001, 37.913, 23.6, 12, t(200)));        // at sea
  pipeline.handle(pos(239000001, 37.9418, 23.6372, 0.1, t(180)));   // berthed
  pipeline.handle(pos(239000001, 37.9418, 23.6372, 0.1, t(100)));
  pipeline.handle(pos(239000001, 37.913, 23.6, 11, t(60)));         // left

  const s = store.stats(config.liveWindowMin, now);
  assert.equal(s.arrivals24h, 1);
  assert.equal(s.departures24h, 1);
  assert.equal(s.inPortNow, 0);
  assert.deepEqual(s.dwellByCategory.map((r) => ({ ...r })),
    [{ category: 'Cargo', calls: 1, avgDwellMin: 120 }]);
  assert.equal(s.recentCalls[0].dwellMin, 120);
});

test('harbour craft are excluded from port-call statistics', () => {
  const { store, pipeline } = setup();
  const now = new Date();
  pipeline.handle(staticMsg(239000002, 52)); // tug
  pipeline.handle(pos(239000002, 37.9418, 23.6372, 0, new Date(now - 60000).toISOString()));
  const s = store.stats(config.liveWindowMin, now);
  assert.equal(s.inPortNow, 0);
  assert.equal(s.liveVessels, 1);
});

test('stores at most one track point per interval', () => {
  const { store, pipeline } = setup();
  const base = Date.now() - 10 * 60000;
  for (let i = 0; i < 20; i += 1) {
    pipeline.handle(pos(239000003, 37.8, 23.5 + i * 0.001, 10, new Date(base + i * 10000).toISOString()));
  }
  // 20 reports over 190 seconds -> one point per 60 s
  assert.equal(store.track(239000003, 1).length, 4);
});

test('the demo feed produces port calls for every scheduled ship type', () => {
  const { store, pipeline } = setup();
  const now = Date.now();
  for (const v of FLEET) pipeline.handle(staticMsg(v.mmsi, v.type));
  for (let t = now - 24 * 3600000; t <= now; t += 60000) {
    for (const v of FLEET) pipeline.handle(positionMessage(v, new Date(t)));
  }
  const s = store.stats(config.liveWindowMin, new Date(now));
  const categories = s.dwellByCategory.map((d) => d.category).sort();
  assert.deepEqual(categories, ['Cargo', 'High-speed craft', 'Passenger']);
  assert.equal(s.liveVessels, FLEET.length);
});

test('a later message without a ship type does not erase the known category', () => {
  const { store, pipeline } = setup();
  pipeline.handle(staticMsg(239000009, 37));
  pipeline.handle({ MessageType: 'StaticDataReport', MetaData: { MMSI: 239000009 },
    Message: { StaticDataReport: { Valid: true, ReportA: { Valid: true, Name: 'YACHT' } } } });
  pipeline.handle(pos(239000009, 37.8, 23.5, 3, new Date().toISOString()));
  const v = store.liveVessels(30).find((x) => x.mmsi === 239000009);
  assert.equal(v.category, 'Pleasure craft');
  assert.equal(v.name, 'YACHT');
});

test('a vessel already berthed when first seen is in port but not an arrival', () => {
  const { store, pipeline } = setup();
  const now = new Date();
  const t = (min) => new Date(now.getTime() - min * 60000).toISOString();
  pipeline.handle(staticMsg(239000010, 60));
  pipeline.handle(pos(239000010, 37.9418, 23.6372, 0, t(90)));   // first sighting, berthed
  pipeline.handle(pos(239000010, 37.9418, 23.6372, 0, t(60)));
  let s = store.stats(config.liveWindowMin, now);
  assert.equal(s.inPortNow, 1);
  assert.equal(s.arrivals24h, 0);

  pipeline.handle(pos(239000010, 37.913, 23.6, 14, t(20)));      // leaves
  s = store.stats(config.liveWindowMin, now);
  assert.equal(s.departures24h, 1);
  assert.deepEqual(s.dwellByCategory, [], 'unknown arrival time: no dwell figure');
  assert.equal(s.recentCalls[0].dwellMin, null);
});

test('a long gap in reception also makes the arrival time unknown', () => {
  const { store, pipeline } = setup();
  const now = new Date();
  const t = (min) => new Date(now.getTime() - min * 60000).toISOString();
  pipeline.handle(staticMsg(239000011, 70));
  pipeline.handle(pos(239000011, 37.8, 23.5, 12, t(300)));       // at sea
  pipeline.handle(pos(239000011, 37.9418, 23.6372, 0, t(200)));  // next report: berthed, 100 min later
  const s = store.stats(config.liveWindowMin, now);
  assert.equal(s.inPortNow, 1);
  assert.equal(s.arrivals24h, 0);
});
