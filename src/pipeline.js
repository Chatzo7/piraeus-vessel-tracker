'use strict';

const { normalize } = require('./ais');

// A vessel not heard from for this long is treated as newly seen, so a
// berthed position does not count as a real arrival.
const GAP_MS = 30 * 60000;

/**
 * Wires a raw AIS message through normalisation, storage and port-call
 * detection. Returns the normalised record (or null if it was dropped).
 */
function createPipeline({ store, detector, config, now = () => new Date() }) {
  const counters = { received: 0, stored: 0, dropped: 0, events: 0 };

  function handle(raw) {
    counters.received += 1;
    const rec = normalize(raw, now());
    if (!rec) {
      counters.dropped += 1;
      return null;
    }
    if (rec.kind === 'static') {
      store.saveStatic(rec);
    } else {
      const prev = store.lastSeen(rec.mmsi);
      const newlySeen = !prev || Date.parse(rec.time) - Date.parse(prev) > GAP_MS;
      store.savePosition(rec, config.trackIntervalSec);
      const event = detector.update(rec);
      if (event) {
        if (event.type === 'arrival') event.arrivalKnown = !newlySeen;
        store.saveEvent(event);
        counters.events += 1;
      }
    }
    counters.stored += 1;
    return rec;
  }

  return { handle, counters };
}

module.exports = { createPipeline };
