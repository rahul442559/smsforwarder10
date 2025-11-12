// server.js — SMS receiver with SSE auto-push & per-message delete
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- One body reader (avoid conflicts) ----
app.use(express.text({ type: '*/*', limit: '1mb' }));

// ---- In-memory store ----
let NEXT_ID = 1;
const store = []; // { id, tsIso, parts:{ time, to, text } }

// ---- SSE clients ----
const clients = new Set(); // each is { id, res }
function sseSend(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    try { c.res.write(data); } catch {}
  }
}

// ---- Helpers ----
function extractMessage(raw) {
  if (!raw || typeof raw !== 'string') return '';
  // urlencoded
  try {
    const u = new URLSearchParams(raw);
    const m = u.get('message');
    if (m !== null) return String(m);
  } catch {}
  // json
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object' && 'message' in o) return String(o.message ?? '');
  } catch {}
  // plain
  return raw;
}
function parseParts(parsed) {
  const p = (parsed || '').split('##');
  // shape from your APK: time##from##country##to##text...
  const time = p[0] || '';
  const to = p[3] || '';
  const text = p.slice(4).join('##') || '';
  return { time, to, text };
}

// ---- Receive endpoints (both new/old paths supported) ----
function handleIncoming(req, res) {
  const raw = typeof req.body === 'string' ? req.body : '';
  const parts = parseParts(extractMessage(raw));

  const rec = {
    id: NEXT_ID++,
    tsIso: new Date().toISOString(),
    parts: { time: parts.time, to: parts.to, text: parts.text },
  };
  store.push(rec);

  // push to clients
  sseSend({ type: 'new', data: rec });

  // APK expects "successful"
  res.status(200).type('text/plain').send('successful');
}
app.post('/sms', handleIncoming);
app.post('/android-sms/android-sms.php', handleIncoming); // backward-compat

// ---- Public minimal API (no raw/headers) ----
app.get('/api/messages', (_req, res) => {
  res.json(store.slice().reverse()); // newest first
});
app.delete('/api/messages/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = store.findIndex(r => r.id === id);
  if (idx !== -1) {
    store.splice(idx, 1);
    sseSend({ type: 'delete', id });
  }
  res.json({ ok: true });
});

// ---- SSE stream ----
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('\n'); // open
  const client = { id: Date.now() + Math.random(), res };
  clients.add(client);

  // send initial list (newest first)
  res.write(`data: ${JSON.stringify({ type: 'init', data: store.slice().reverse() })}\n\n`);

  // keep-alive ping
  const ping = setInterval(() => res.write(':\n\n'), 15000);

  req.on('close', () => { clearInterval(ping); clients.delete(client); });
});

// ---- Static site ----
app.use(express.static(path.join(__dirname)));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Server on ${PORT}`));
