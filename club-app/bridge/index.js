/**
 * ESSL K90 Bridge
 * ───────────────────────────────────────────────────────────────
 * Connects to the ESSL K90 fingerprint device on the local network,
 * listens for real-time fingerprint punches, and broadcasts them to
 * any connected WebSocket client (e.g. the Reception tab).
 *
 * SETUP:
 *   1. Find the device IP: Menu → Communication → Ethernet on the K90
 *   2. Set DEVICE_IP below (or pass as env var: DEVICE_IP=192.168.1.X node index.js)
 *   3. npm install
 *   4. node index.js
 *
 * The Reception app connects to ws://localhost:7890 automatically.
 * ───────────────────────────────────────────────────────────────
 */

const ZKLib          = require('node-zklib');
const { WebSocketServer } = require('ws');

// ── Configure ────────────────────────────────────────────────────
const DEVICE_IP   = process.env.DEVICE_IP   || '192.168.1.100'; // ← set your K90 IP here
const DEVICE_PORT = Number(process.env.DEVICE_PORT) || 4370;
const WS_PORT     = Number(process.env.WS_PORT)     || 7890;
// ─────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[Bridge] WebSocket server listening on ws://localhost:${WS_PORT}`);

wss.on('connection', () => {
  console.log('[Bridge] Reception app connected');
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1 /* OPEN */) client.send(msg);
  });
}

async function connect() {
  const zk = new ZKLib(DEVICE_IP, DEVICE_PORT, 10000, 4000);

  try {
    await zk.createSocket();
    console.log(`[Bridge] ✓ Connected to ESSL K90 at ${DEVICE_IP}:${DEVICE_PORT}`);

    // Broadcast connection status so the app can show "Device Connected"
    broadcast({ type: 'status', connected: true });

    zk.on && zk.on('disconnect', () => {
      console.warn('[Bridge] Device disconnected — retrying in 5s...');
      broadcast({ type: 'status', connected: false });
      setTimeout(connect, 5000);
    });

    await zk.getRealTimeLogs((data) => {
      if (!data || !data.userId) return;
      const esslId = String(data.userId).trim();
      const time   = data.attTime || new Date().toISOString();
      console.log(`[Bridge] Punch → ESSL ID: ${esslId}  time: ${time}`);
      broadcast({ type: 'punch', esslId, time });
    });

  } catch (err) {
    console.error('[Bridge] Connection failed:', err.message);
    console.log('[Bridge] Retrying in 5s...');
    broadcast({ type: 'status', connected: false });
    setTimeout(connect, 5000);
  }
}

connect();
