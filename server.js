const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== ইনবক্স স্টোরেজ (in-memory) =====
const messages = [];          // [{id, parts:{to,text,time}}]
const TTL_MS = 3 * 60 * 1000; // 3 মিনিট

// ===== SSE clients =====
const sseClients = new Set(); // res objects

function sseSend(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch {}
  }
}

function cleanupExpired() {
  const now = Date.now();
  let changed = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].expiresAt <= now) {
      const id = messages[i].id;
      messages.splice(i, 1);
      changed = true;

      // notify delete
      sseSend({ type: 'delete', id });
      io.emit('messageDeleted', { id, reason: 'expired' });
    }
  }
  return changed;
}

// প্রতি 15 সেকেন্ডে expired ক্লিনআপ
setInterval(cleanupExpired, 15000);

// ===== SMS রিসিভ =====
// তোমার sender যদি key/time পাঠায় সেটা চলবে
// আর যদি to/text/time পাঠায় সেটাও চলবে
app.post('/sms', (req, res) => {
  const now = Date.now();

  const to = req.body.to || req.body.mobile || req.body.number || '';
  const text = req.body.text || req.body.message || req.body.key || 'No message received';
  const time = req.body.time || new Date().toISOString();

  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const expiresAt = now + TTL_MS;

  const rec = { id, parts: { to, text, time }, expiresAt };

  // লেটেস্ট সবার উপরে রাখতে unshift
  messages.unshift(rec);

  console.log('Processed SMS:', rec);

  // SSE + Socket.IO দুদিকেই পাঠাই
  sseSend({ type: 'new', data: rec });
  io.emit('newMessage', rec);

  res.status(200).json({ success: true, id, expiresAt });
});

// ===== API: সব মেসেজ =====
app.get('/api/messages', (req, res) => {
  cleanupExpired();
  // UI রেন্ডারের জন্য expiresAt দরকার নেই
  const out = messages.map(({ id, parts }) => ({ id, parts }));
  res.json(out);
});

// ===== API: নির্দিষ্ট মেসেজ ডিলিট =====
app.delete('/api/messages/:id', (req, res) => {
  const id = req.params.id;
  const idx = messages.findIndex(m => m.id === id);
  if (idx !== -1) {
    messages.splice(idx, 1);
    sseSend({ type: 'delete', id });
    io.emit('messageDeleted', { id, reason: 'deleted' });
  }
  res.json({ success: true });
});

// ===== SSE endpoint =====
app.get('/events', (req, res) => {
  // headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.add(res);

  // init batch পাঠাই (লেটেস্ট আগে থেকেই messages[0])
  cleanupExpired();
  const initData = messages.map(({ id, parts }) => ({ id, parts }));
  res.write(`data: ${JSON.stringify({ type: 'init', data: initData })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// UI সার্ভ করুন
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Socket.IO (থাকলো, কিন্তু UI এখন SSE দিয়েই কাজ করবে)
io.on('connection', (socket) => {
  console.log('A user connected');
  cleanupExpired();
  // চাইলে socket দিয়ে init পাঠাতে পারো, আপাতত optional
  socket.on('disconnect', () => console.log('A user disconnected'));
});

// PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
