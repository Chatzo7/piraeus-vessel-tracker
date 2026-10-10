'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pointInPolygon } = require('../src/geo');
const { PortCallDetector } = require('../src/portcalls');
const config = require('../src/config');

const square = [[0, 0], [0, 10], [10, 10], [10, 0]];
const detectorConfig = { polygon: square, berthSpeedKnots: 1 };
const at = (lat, lon, sog, time) => ({ mmsi: 239000001, lat, lon, sog, time });

test('point-in-polygon', () => {
  assert.equal(pointInPolygon(5, 5, square), true);
  assert.equal(pointInPolygon(11, 5, square), false);
  assert.equal(pointInPolygon(37.9418, 23.6372, config.portPolygon), true, 'central port berth');
  assert.equal(pointInPolygon(37.902, 23.552, config.portPolygon), false, 'anchorage');
});

test('opens a call when a vessel stops inside the port and closes it on exit', () => {
  const d = new PortCallDetector(detectorConfig);
  assert.equal(d.update(at(20, 20, 12, 't0')), null, 'at sea');
  assert.equal(d.update(at(5, 5, 8, 't1')), null, 'entering, still moving');
  assert.deepEqual(d.update(at(5, 5, 0.2, 't2')), { type: 'arrival', mmsi: 239000001, time: 't2' });
  assert.equal(d.update(at(5, 6, 3, 't3')), null, 'manoeuvring inside keeps the call open');
  assert.deepEqual(d.update(at(12, 5, 10, 't4')),
    { type: 'departure', mmsi: 239000001, time: 't4', arrival: 't2' });
  assert.equal(d.isInPort(239000001), false);
});

test('a vessel passing through without stopping is not a call', () => {
  const d = new PortCallDetector(detectorConfig);
  assert.equal(d.update(at(5, 5, 9, 't1')), null);
  assert.equal(d.update(at(12, 5, 9, 't2')), null);
});

test('missing speed never starts a call', () => {
  const d = new PortCallDetector(detectorConfig);
  assert.equal(d.update(at(5, 5, null, 't1')), null);
});

test('open calls survive a restart', () => {
  const d = new PortCallDetector(detectorConfig, [{ mmsi: 239000001, arrival: 't0' }]);
  assert.equal(d.isInPort(239000001), true);
  assert.equal(d.update(at(12, 5, 10, 't5')).arrival, 't0');
});
