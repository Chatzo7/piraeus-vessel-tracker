'use strict';

const REFRESH_MS = 10000;

const COLORS = {
  Passenger: '#2f6fdf',
  'High-speed craft': '#7b4fd6',
  Cargo: '#2e9d5b',
  Tanker: '#d64545',
  Tug: '#e08a1e',
  Pilot: '#c9a400',
  Fishing: '#16a0a0',
  Sailing: '#8a8f98',
  'Pleasure craft': '#8a8f98',
};
const OTHER_COLOR = '#6b7785';
const colorFor = (category) => COLORS[category] || OTHER_COLOR;

// AIS names and destinations come from the vessels themselves: always escape.
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'Europe/Athens' });

function fmtTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  const sameDay = dayFmt.format(d) === dayFmt.format(new Date());
  return sameDay ? timeFmt.format(d) : `${dayFmt.format(d)} ${timeFmt.format(d)}`;
}

function fmtDuration(min) {
  if (min === null || min === undefined) return '–';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- map

const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([37.9, 23.55], 11);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const markers = new Map();
let trackLine = null;
let selected = null;

function vesselIcon(v) {
  const color = colorFor(v.category);
  const moving = v.sog !== null && v.sog > 0.5;
  const size = v.length && v.length > 150 ? 22 : v.length && v.length > 60 ? 18 : 15;
  const shape = moving
    ? `<path d="M0,-${size / 2} L${size / 3},${size / 2} L0,${size / 3.2} L-${size / 3},${size / 2} Z"
         fill="${color}" stroke="#fff" stroke-width="1.4" transform="rotate(${v.cog || 0})"/>`
    : `<circle r="${size / 3.2}" fill="${color}" stroke="#fff" stroke-width="1.6"/>`;
  const ring = v.inPort ? `<circle r="${size / 1.6}" fill="none" stroke="${color}" stroke-opacity="0.45" stroke-width="2"/>` : '';
  return L.divIcon({
    className: 'vessel-icon',
    iconSize: [size * 2, size * 2],
    html: `<svg width="${size * 2}" height="${size * 2}" viewBox="-${size} -${size} ${size * 2} ${size * 2}">${ring}${shape}</svg>`,
  });
}

function popupHtml(v) {
  const rows = [
    ['MMSI', v.mmsi],
    ['IMO', v.imo],
    ['Type', v.category],
    ['Speed', v.sog !== null ? `${v.sog.toFixed(1)} kn` : null],
    ['Course', v.cog !== null && v.sog > 0.5 ? `${Math.round(v.cog)}°` : null],
    ['Length', v.length ? `${Math.round(v.length)} m` : null],
    ['Destination', v.destination],
    ['Status', v.inPort ? 'In port' : null],
    ['Last seen', ago(v.lastSeen)],
  ].filter(([, val]) => val !== null && val !== undefined && val !== '');
  return `<div class="pop-title">${esc(v.name || 'Unknown vessel')}</div>
    <dl class="pop-grid">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join('')}</dl>`;
}

async function showTrack(mmsi) {
  const color = colorFor(markers.get(mmsi)?.vessel.category);
  const points = await getJson(`/api/vessels/${mmsi}/track?hours=6`);
  if (trackLine) trackLine.remove();
  trackLine = L.polyline(points.map((p) => [p.lat, p.lon]), {
    color, weight: 2.5, opacity: 0.75, dashArray: '4 5',
  }).addTo(map);
}

function renderVessels(vessels) {
  const seen = new Set();
  for (const v of vessels) {
    seen.add(v.mmsi);
    let entry = markers.get(v.mmsi);
    if (!entry) {
      const marker = L.marker([v.lat, v.lon], { icon: vesselIcon(v), title: v.name || String(v.mmsi) })
        .bindPopup('')
        .on('click', () => { selected = v.mmsi; showTrack(v.mmsi).catch(console.error); })
        .on('popupclose', () => { selected = null; if (trackLine) { trackLine.remove(); trackLine = null; } })
        .addTo(map);
      entry = { marker, vessel: v };
      markers.set(v.mmsi, entry);
    }
    entry.vessel = v;
    entry.marker.setLatLng([v.lat, v.lon]);
    entry.marker.setIcon(vesselIcon(v));
    entry.marker.setPopupContent(popupHtml(v));
  }
  for (const [mmsi, entry] of markers) {
    if (!seen.has(mmsi)) {
      entry.marker.remove();
      markers.delete(mmsi);
    }
  }
  if (selected && markers.has(selected)) showTrack(selected).catch(console.error);
}

function renderLegend() {
  const items = [
    ['Passenger', COLORS.Passenger], ['High-speed', COLORS['High-speed craft']],
    ['Cargo', COLORS.Cargo], ['Tanker', COLORS.Tanker],
    ['Tug / pilot', COLORS.Tug], ['Other', OTHER_COLOR],
  ];
  document.getElementById('legend').innerHTML = items
    .map(([label, color]) => `<span><i class="dot" style="background:${color}"></i>${label}</span>`)
    .join('');
}

// ---------------------------------------------------------------- panel

function renderStats(s) {
  document.getElementById('k-live').textContent = s.liveVessels;
  document.getElementById('k-port').textContent = s.inPortNow;
  document.getElementById('k-arr').textContent = s.arrivals24h;
  document.getElementById('k-dep').textContent = s.departures24h;

  const max = Math.max(1, ...s.liveByCategory.map((c) => c.vessels));
  document.getElementById('by-type').innerHTML = s.liveByCategory.length
    ? s.liveByCategory.map((c) => `
      <li>
        <span class="name"><i class="dot" style="background:${colorFor(c.category)}"></i>${esc(c.category)}</span>
        <span class="track"><span class="fill" style="width:${(c.vessels / max) * 100}%;background:${colorFor(c.category)}"></span></span>
        <span class="count">${c.vessels}</span>
      </li>`).join('')
    : '<p class="empty">No vessels reporting yet.</p>';

  const tbody = document.querySelector('#dwell tbody');
  tbody.innerHTML = s.dwellByCategory.length
    ? s.dwellByCategory.map((d) => `
      <tr><td>${esc(d.category)}</td><td class="num">${d.calls}</td><td class="num">${fmtDuration(d.avgDwellMin)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">No completed port calls yet.</td></tr>';

  document.getElementById('calls').innerHTML = s.recentCalls.length
    ? s.recentCalls.map((c) => {
      const inPort = !c.departure;
      return `<li>
        <div>
          <div class="vessel">${esc(c.name || c.mmsi)}</div>
          <div class="meta">${esc(c.category || 'Unknown')} · ${inPort ? '<span class="pill">in port</span>' : (c.arrivalKnown ? `stayed ${fmtDuration(c.dwellMin)}` : 'left port')}</div>
        </div>
        <div class="when">${inPort ? `${c.arrivalKnown ? 'arr' : 'seen'} ${fmtTime(c.arrival)}` : `dep ${fmtTime(c.departure)}`}</div>
      </li>`;
    }).join('')
    : '<p class="empty">No port calls recorded yet.</p>';
}

// ---------------------------------------------------------------- loop

async function refresh() {
  try {
    const [vessels, stats] = await Promise.all([getJson('/api/vessels'), getJson('/api/stats')]);
    renderVessels(vessels);
    renderStats(stats);
    document.getElementById('updated').textContent = `Updated ${timeFmt.format(new Date())}`;
  } catch (err) {
    console.error(err);
    document.getElementById('updated').textContent = 'Connection problem – retrying';
  }
}

async function init() {
  renderLegend();
  try {
    const cfg = await getJson('/api/config');
    L.polygon(cfg.portPolygon, {
      color: '#1f7a8c', weight: 1.5, dashArray: '5 4', fillColor: '#1f7a8c', fillOpacity: 0.06,
    }).bindTooltip('Port of Piraeus (port-call area)', { sticky: true }).addTo(map);
    const badge = document.getElementById('mode');
    badge.hidden = false;
    badge.textContent = cfg.mode === 'demo' ? 'DEMO DATA' : 'LIVE';
    badge.classList.toggle('live', cfg.mode !== 'demo');
  } catch (err) {
    console.error(err);
  }
  await refresh();
  setInterval(refresh, REFRESH_MS);
}

init();
