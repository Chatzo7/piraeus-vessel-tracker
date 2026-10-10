'use strict';

// Area streamed from AISStream: the Saronic Gulf around Piraeus.
// Each corner is [latitude, longitude].
const STREAM_BOX = [
  [37.55, 23.25],
  [38.05, 23.8],
];

// Approximate outline of the Port of Piraeus (central passenger port,
// Kastela/Zea side excluded, container terminals at Neo Ikonio included).
// Polygon vertices are [latitude, longitude]. Adjust as needed.
const PORT_POLYGON = [
  [37.9625, 23.555],
  [37.9625, 23.6],
  [37.951, 23.624],
  [37.9485, 23.6455],
  [37.935, 23.6505],
  [37.928, 23.636],
  [37.934, 23.6],
  [37.9445, 23.555],
];

const config = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || 'data/tracker.db',
  aisApiKey: process.env.AISSTREAM_API_KEY || '',
  streamBox: STREAM_BOX,
  portPolygon: PORT_POLYGON,
  // A vessel counts as berthed when inside the port polygon below this speed (knots).
  berthSpeedKnots: 1,
  // Store at most one track point per vessel per this many seconds.
  trackIntervalSec: 60,
  // Vessels not heard from for this long are hidden from the live map.
  liveWindowMin: 30,
  // Track points older than this are deleted.
  retentionDays: 7,
};

module.exports = config;
