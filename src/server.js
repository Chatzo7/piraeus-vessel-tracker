'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: 'Not found' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      // Revalidate on every load so a new version is picked up straight away.
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function createServer({ store, config, mode, counters }) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

    try {
      if (pathname === '/api/config') {
        return sendJson(res, 200, {
          mode,
          portPolygon: config.portPolygon,
          streamBox: config.streamBox,
          liveWindowMin: config.liveWindowMin,
        });
      }
      if (pathname === '/api/vessels') {
        return sendJson(res, 200, store.liveVessels(config.liveWindowMin));
      }
      const track = pathname.match(/^\/api\/vessels\/(\d{9})\/track$/);
      if (track) {
        const hours = Math.min(Math.max(Number(url.searchParams.get('hours')) || 6, 1), 48);
        return sendJson(res, 200, store.track(Number(track[1]), hours));
      }
      if (pathname === '/api/stats') {
        return sendJson(res, 200, store.stats(config.liveWindowMin));
      }
      if (pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, mode, ...counters });
      }
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      return serveStatic(req, res, pathname);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: 'Internal error' });
    }
  });
}

module.exports = { createServer };
