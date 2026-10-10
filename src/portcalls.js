'use strict';

const { pointInPolygon } = require('./geo');

/**
 * Detects port calls from a stream of positions.
 *
 * A call starts the first time a vessel is seen inside the port polygon at or
 * below berthSpeedKnots, and ends the first time it is seen outside the
 * polygon again. Vessels manoeuvring inside the port keep their open call.
 *
 * The detector holds only the open calls in memory; it can be seeded with the
 * open calls stored in the database so restarts do not lose state.
 */
class PortCallDetector {
  constructor({ polygon, berthSpeedKnots }, openCalls = []) {
    this.polygon = polygon;
    this.berthSpeed = berthSpeedKnots;
    this.open = new Map(openCalls.map((c) => [c.mmsi, c.arrival]));
  }

  isInPort(mmsi) {
    return this.open.has(mmsi);
  }

  /** Returns an event ({type:'arrival'|'departure', mmsi, time}) or null. */
  update({ mmsi, lat, lon, sog, time }) {
    const inside = pointInPolygon(lat, lon, this.polygon);
    const inPort = this.open.has(mmsi);

    if (!inPort && inside && sog !== null && sog <= this.berthSpeed) {
      this.open.set(mmsi, time);
      return { type: 'arrival', mmsi, time };
    }
    if (inPort && !inside) {
      const arrival = this.open.get(mmsi);
      this.open.delete(mmsi);
      return { type: 'departure', mmsi, time, arrival };
    }
    return null;
  }
}

module.exports = { PortCallDetector };
