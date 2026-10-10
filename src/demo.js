'use strict';

// Demo feed: simulated vessels that emit AISStream-shaped messages, so the app
// can be run and shown without an API key. All names and MMSIs are fictitious.

const P = {
  centralBerth: [37.9418, 23.6372],
  cruiseBerth: [37.9375, 23.6255],
  roroBerth: [37.9445, 23.6405],
  centralMouth: [37.9295, 23.6175],
  offPiraeus: [37.913, 23.6],
  ctBerth: [37.9515, 23.5785],
  ctBerth2: [37.9538, 23.5848],
  tugBase: [37.9488, 23.5905],
  southHold: [37.66, 23.715],
  ctApproach: [37.932, 23.566],
  anchorage: [37.902, 23.552],
  aeginaApproach: [37.752, 23.438],
  aeginaBerth: [37.7468, 23.4282],
  southExit: [37.6, 23.66],
  westExit: [37.82, 23.27],
  salaminaFishing: [37.872, 23.505],
};

// Each vessel follows a cyclic schedule of moves (to a point at a speed) and waits.
const FLEET = [
  { mmsi: 999000001, name: 'SARONIC STAR', type: 60, length: 98, phase: 0,
    plan: [['wait', 40, 'centralBerth'], ['go', 15, 'centralMouth', 'offPiraeus', 'aeginaApproach', 'aeginaBerth'],
      ['wait', 40, 'aeginaBerth'], ['go', 15, 'aeginaApproach', 'offPiraeus', 'centralMouth', 'centralBerth']] },
  { mmsi: 999000002, name: 'AEGINA SPIRIT', type: 60, length: 86, phase: 95,
    plan: [['wait', 40, 'centralBerth'], ['go', 15, 'centralMouth', 'offPiraeus', 'aeginaApproach', 'aeginaBerth'],
      ['wait', 40, 'aeginaBerth'], ['go', 15, 'aeginaApproach', 'offPiraeus', 'centralMouth', 'centralBerth']] },
  { mmsi: 999000003, name: 'FLYING DOLPHIN X', type: 40, length: 42, phase: 30,
    plan: [['wait', 25, 'centralBerth'], ['go', 27, 'centralMouth', 'offPiraeus', 'aeginaApproach', 'aeginaBerth'],
      ['wait', 25, 'aeginaBerth'], ['go', 27, 'aeginaApproach', 'offPiraeus', 'centralMouth', 'centralBerth']] },
  { mmsi: 999000004, name: 'MEDITERRANEAN LINK', type: 71, length: 300, phase: 0,
    plan: [['go', 14, 'southExit', 'offPiraeus', 'ctApproach', 'ctBerth'], ['wait', 600, 'ctBerth'],
      ['go', 12, 'ctApproach', 'offPiraeus', 'southExit'], ['wait', 300, 'southExit']] },
  { mmsi: 999000005, name: 'IONIAN TRADER', type: 70, length: 220, phase: 700,
    plan: [['go', 13, 'westExit', 'anchorage', 'ctApproach', 'ctBerth2'], ['wait', 480, 'ctBerth2'],
      ['go', 12, 'ctApproach', 'anchorage', 'westExit'], ['wait', 400, 'westExit']] },
  { mmsi: 999000006, name: 'HELLAS ENERGY', type: 80, length: 183, phase: 0,
    plan: [['wait', 1440, 'anchorage']] },
  { mmsi: 999000007, name: 'PIRAEUS TUG 7', type: 52, length: 32, phase: 10,
    plan: [['wait', 30, 'tugBase'], ['go', 6, 'ctApproach'], ['wait', 20, 'ctApproach'], ['go', 6, 'tugBase']] },
  { mmsi: 999000008, name: 'AEGEAN JEWEL', type: 60, length: 294, phase: 200,
    plan: [['go', 16, 'southHold', 'offPiraeus', 'centralMouth', 'cruiseBerth'], ['wait', 540, 'cruiseBerth'],
      ['go', 16, 'centralMouth', 'offPiraeus', 'southHold'], ['wait', 700, 'southHold']] },
  { mmsi: 999000009, name: 'CRETAN BRIDGE', type: 70, length: 190, phase: 400,
    plan: [['go', 18, 'southExit', 'offPiraeus', 'centralMouth', 'roroBerth'], ['wait', 120, 'roroBerth'],
      ['go', 18, 'centralMouth', 'offPiraeus', 'southExit'], ['wait', 360, 'southExit']] },
  { mmsi: 999000010, name: 'MELTEMI', type: 36, length: 14, phase: 0,
    plan: [['go', 6, 'offPiraeus', 'salaminaFishing', 'aeginaApproach', 'offPiraeus']] },
  { mmsi: 999000011, name: 'AGIOS NIKOLAOS', type: 30, length: 18, phase: 60,
    plan: [['wait', 180, 'salaminaFishing'], ['go', 5, 'anchorage', 'salaminaFishing']] },
  { mmsi: 999000012, name: 'PILOT PIRAEUS 2', type: 50, length: 16, phase: 5,
    plan: [['wait', 45, 'centralMouth'], ['go', 14, 'anchorage'], ['wait', 15, 'anchorage'], ['go', 14, 'centralMouth']] },
];

const toRad = (d) => (d * Math.PI) / 180;

function distanceNm([lat1, lon1], [lat2, lon2]) {
  const x = toRad(lon2 - lon1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * 3440.065;
}

function bearing([lat1, lon1], [lat2, lon2]) {
  const x = toRad(lon2 - lon1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

// Expand a plan into timed segments: {from, to, minutes, speed} or {at, minutes}.
function buildSegments(plan) {
  const segs = [];
  let pos = P[plan[0][0] === 'wait' ? plan[0][2] : plan[plan.length - 1][plan[plan.length - 1].length - 1]];
  for (const step of plan) {
    if (step[0] === 'wait') {
      pos = P[step[2]];
      segs.push({ at: pos, minutes: step[1] });
    } else {
      const speed = step[1];
      for (const name of step.slice(2)) {
        const to = P[name];
        const minutes = (distanceNm(pos, to) / speed) * 60;
        if (minutes > 0.01) segs.push({ from: pos, to, minutes, speed });
        pos = to;
      }
    }
  }
  return segs;
}

for (const v of FLEET) {
  v.segments = buildSegments(v.plan);
  v.cycle = v.segments.reduce((s, x) => s + x.minutes, 0);
}

function stateAt(vessel, date) {
  let t = (date.getTime() / 60000 + vessel.phase) % vessel.cycle;
  for (const seg of vessel.segments) {
    if (t <= seg.minutes) {
      if (seg.at) {
        const wobble = Math.sin(date.getTime() / 97000 + vessel.mmsi) * 0.00004;
        const anchored = seg.at === P.anchorage || seg.at === P.southExit || seg.at === P.westExit || seg.at === P.southHold ||
          seg.at === P.salaminaFishing;
        return { lat: seg.at[0] + wobble, lon: seg.at[1] + wobble, sog: 0.1, cog: 0,
          navStatus: anchored ? 1 : 5 };
      }
      const f = t / seg.minutes;
      return {
        lat: seg.from[0] + (seg.to[0] - seg.from[0]) * f,
        lon: seg.from[1] + (seg.to[1] - seg.from[1]) * f,
        sog: seg.speed,
        cog: bearing(seg.from, seg.to),
        navStatus: 0,
      };
    }
    t -= seg.minutes;
  }
  const last = vessel.segments[vessel.segments.length - 1];
  const at = last.at || last.to;
  return { lat: at[0], lon: at[1], sog: 0, cog: 0, navStatus: 5 };
}

function aisTime(date) {
  return `${date.toISOString().replace('T', ' ').replace('Z', '')} +0000 UTC`;
}

function positionMessage(vessel, date) {
  const s = stateAt(vessel, date);
  return {
    MessageType: 'PositionReport',
    MetaData: { MMSI: vessel.mmsi, ShipName: vessel.name, latitude: s.lat, longitude: s.lon,
      time_utc: aisTime(date) },
    Message: { PositionReport: { Valid: true, UserID: vessel.mmsi, Latitude: s.lat,
      Longitude: s.lon, Sog: Math.round(s.sog * 10) / 10, Cog: Math.round(s.cog * 10) / 10,
      TrueHeading: Math.round(s.cog), NavigationalStatus: s.navStatus } },
  };
}

function staticMessage(vessel, date) {
  const s = stateAt(vessel, date);
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: vessel.mmsi, ShipName: vessel.name, latitude: s.lat, longitude: s.lon,
      time_utc: aisTime(date) },
    Message: { ShipStaticData: { Valid: true, Name: vessel.name, Type: vessel.type,
      CallSign: `SV${String(vessel.mmsi).slice(-4)}`, ImoNumber: 0, Destination: 'PIRAEUS',
      Dimension: { A: Math.round(vessel.length * 0.6), B: Math.round(vessel.length * 0.4), C: 5, D: 5 } } },
  };
}

/**
 * Replays the last `historyHours` at one-minute steps (so the statistics are
 * filled straight away), then emits live positions every `tickMs`.
 */
function startDemo({ onMessage, historyHours = 24, tickMs = 5000, log = console }) {
  const now = Date.now();
  for (const v of FLEET) onMessage(staticMessage(v, new Date(now - historyHours * 3600000)));
  for (let t = now - historyHours * 3600000; t <= now; t += 60000) {
    for (const v of FLEET) onMessage(positionMessage(v, new Date(t)));
  }
  log.info(`[demo] replayed ${historyHours}h of history for ${FLEET.length} simulated vessels`);

  let tick = 0;
  const timer = setInterval(() => {
    const d = new Date();
    for (const v of FLEET) {
      onMessage(positionMessage(v, d));
      if (tick % 60 === 0) onMessage(staticMessage(v, d));
    }
    tick += 1;
  }, tickMs);

  return { stop: () => clearInterval(timer) };
}

module.exports = { startDemo, FLEET, stateAt, positionMessage, distanceNm, PLACES: P };
