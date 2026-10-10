'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, shipCategory, parseAisTime } = require('../src/ais');

const position = {
  MessageType: 'PositionReport',
  MetaData: {
    MMSI: 239123456, ShipName: 'TEST SHIP   @@', latitude: 37.94, longitude: 23.63,
    time_utc: '2026-10-10 11:22:33.123456789 +0000 UTC',
  },
  Message: {
    PositionReport: {
      Valid: true, Latitude: 37.94, Longitude: 23.63, Sog: 12.3, Cog: 45.5,
      TrueHeading: 46, NavigationalStatus: 0,
    },
  },
};

test('parses AISStream timestamps to ISO', () => {
  assert.equal(parseAisTime('2026-10-10 11:22:33.123456789 +0000 UTC'), '2026-10-10T11:22:33.123Z');
  assert.equal(parseAisTime('nonsense'), null);
});

test('normalises a position report', () => {
  const r = normalize(position);
  assert.equal(r.kind, 'position');
  assert.equal(r.mmsi, 239123456);
  assert.equal(r.name, 'TEST SHIP');
  assert.equal(r.sog, 12.3);
  assert.equal(r.heading, 46);
  assert.equal(r.time, '2026-10-10T11:22:33.123Z');
});

test('treats AIS "not available" values as null', () => {
  const raw = structuredClone(position);
  Object.assign(raw.Message.PositionReport, { Sog: 102.3, Cog: 360, TrueHeading: 511 });
  const r = normalize(raw);
  assert.equal(r.sog, null);
  assert.equal(r.cog, null);
  assert.equal(r.heading, null);
});

test('drops invalid MMSI and impossible coordinates', () => {
  const badMmsi = structuredClone(position);
  badMmsi.MetaData.MMSI = 123;
  assert.equal(normalize(badMmsi), null);

  const zero = structuredClone(position);
  Object.assign(zero.Message.PositionReport, { Latitude: 0, Longitude: 0 });
  assert.equal(normalize(zero), null);
});

test('normalises static data', () => {
  const r = normalize({
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: 239123456, ShipName: 'TEST SHIP' },
    Message: {
      ShipStaticData: {
        Valid: true, Name: 'TEST SHIP', Type: 80, ImoNumber: 9123456, CallSign: 'SVAB',
        Destination: 'PIRAEUS@@@', Dimension: { A: 120, B: 60, C: 15, D: 15 },
      },
    },
  });
  assert.equal(r.kind, 'static');
  assert.equal(r.category, 'Tanker');
  assert.equal(r.imo, 9123456);
  assert.equal(r.destination, 'PIRAEUS');
  assert.equal(r.length, 180);
});

test('maps ship type codes to categories', () => {
  assert.equal(shipCategory(60), 'Passenger');
  assert.equal(shipCategory(74), 'Cargo');
  assert.equal(shipCategory(52), 'Tug');
  assert.equal(shipCategory(0), 'Unknown');
  assert.equal(shipCategory(99), 'Other');
});

test('ignores unsupported message types', () => {
  assert.equal(normalize({ MessageType: 'SafetyBroadcastMessage', MetaData: { MMSI: 239123456 } }), null);
});

test('reads class B static data (message 24, parts A and B)', () => {
  const base = { MessageType: 'StaticDataReport', MetaData: { MMSI: 239555555, ShipName: 'KOKOMO' } };
  const partA = normalize({ ...base, Message: { StaticDataReport: { Valid: true, PartNumber: false,
    ReportA: { Valid: true, Name: 'KOKOMO NIGHTS@@' }, ReportB: { Valid: false } } } });
  assert.equal(partA.kind, 'static');
  assert.equal(partA.name, 'KOKOMO NIGHTS');
  assert.equal(partA.category, 'Unknown');

  const partB = normalize({ ...base, Message: { StaticDataReport: { Valid: true, PartNumber: true,
    ReportA: { Valid: false }, ReportB: { Valid: true, ShipType: 37, CallSign: 'SV1234',
      Dimension: { A: 12, B: 8, C: 3, D: 3 } } } } });
  assert.equal(partB.category, 'Pleasure craft');
  assert.equal(partB.length, 20);
});

test('reads extended class B position reports', () => {
  const r = normalize({ MessageType: 'ExtendedClassBPositionReport',
    MetaData: { MMSI: 239555555 },
    Message: { ExtendedClassBPositionReport: { Valid: true, Latitude: 37.9, Longitude: 23.6, Sog: 4, Cog: 90 } } });
  assert.equal(r.kind, 'position');
  assert.equal(r.sog, 4);
});
