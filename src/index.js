'use strict';

const config = require('./config');
const { Store } = require('./store');
const { PortCallDetector } = require('./portcalls');
const { createPipeline } = require('./pipeline');
const { startAisStream } = require('./aisstream');
const { startDemo } = require('./demo');
const { createServer } = require('./server');

const demo = process.argv.includes('--demo') || process.env.DEMO === '1';

if (!demo && !config.aisApiKey) {
  console.error(
    'No AISSTREAM_API_KEY set.\n' +
    '  - Get a free key at https://aisstream.io and put it in .env, or\n' +
    '  - run with simulated vessels: npm run demo',
  );
  process.exit(1);
}

// Demo data is kept in memory: it never mixes with real AIS data, and every
// run starts fresh because the history is replayed on start-up.
const store = new Store(demo ? ':memory:' : config.dbPath);
const detector = new PortCallDetector(
  { polygon: config.portPolygon, berthSpeedKnots: config.berthSpeedKnots },
  store.loadOpenCalls(),
);
const pipeline = createPipeline({ store, detector, config });

// The demo replays 24 hours of history at start-up; one transaction keeps that fast.
const feed = demo
  ? store.transaction(() => startDemo({ onMessage: pipeline.handle }))
  : startAisStream({ apiKey: config.aisApiKey, box: config.streamBox, onMessage: pipeline.handle });

const pruneTimer = setInterval(() => store.prune(config.retentionDays), 3600000);

const server = createServer({ store, config, mode: demo ? 'demo' : 'live', counters: pipeline.counters });
server.listen(config.port, () => {
  console.log(`Piraeus Vessel Tracker (${demo ? 'demo' : 'live'}) on http://localhost:${config.port}`);
});

function shutdown() {
  feed.stop();
  clearInterval(pruneTimer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
