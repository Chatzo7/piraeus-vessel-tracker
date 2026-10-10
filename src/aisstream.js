'use strict';

// Live feed from AISStream.io over WebSocket, using Node's built-in client.
// Docs: https://aisstream.io/documentation

const URL = 'wss://stream.aisstream.io/v0/stream';
const decoder = new TextDecoder();

function startAisStream({ apiKey, box, onMessage, log = console }) {
  let socket = null;
  let stopped = false;
  let retryMs = 1000;

  function connect() {
    socket = new WebSocket(URL);
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      retryMs = 1000;
      // The subscription must be sent within 3 seconds of connecting.
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [box],
        FilterMessageTypes: [
          'PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport',
          'ShipStaticData', 'StaticDataReport',
        ],
      }));
      log.info('[ais] connected to AISStream');
    });

    socket.addEventListener('message', (ev) => {
      try {
        const text = typeof ev.data === 'string' ? ev.data : decoder.decode(ev.data);
        const msg = JSON.parse(text);
        if (msg.error) {
          log.error(`[ais] server error: ${msg.error}`);
          return;
        }
        onMessage(msg);
      } catch (err) {
        log.warn(`[ais] could not parse message: ${err.message}`);
      }
    });

    socket.addEventListener('close', (ev) => {
      if (stopped) return;
      log.warn(`[ais] connection closed (${ev.code}); retrying in ${retryMs / 1000}s`);
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 60000);
    });

    socket.addEventListener('error', () => {
      // 'close' follows and handles the retry.
    });
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (socket) socket.close();
    },
  };
}

module.exports = { startAisStream };
