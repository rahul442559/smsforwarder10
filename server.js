// server.js  (safe version)
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// raw body ক্যাপচার
app.use((req, res, next) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', c => (data += c));
  req.on('end', () => { req.rawBody = data || ''; next(); });
});

// যেকোনো কনটেন্ট-টাইপ পার্স করার চেষ্টা
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.text({ type: '*/*' }));

const received = [];

function extractMessage(req) {
  if (req.body && typeof req.body === 'object' && 'message' in req.body)
    return String(req.body.message ?? '');

  if (typeof req.rawBody === 'string' && req.rawBody.trim()) {
    const rb = req.rawBody.trim();
    try { const u = new URLSearchParams(rb); const m = u.get('message'); if (m) return String(m); } catch {}
    try { const o = JSON.parse(rb); if (o && 'message' in o) return String(o.message ?? ''); } catch {}
    return rb; // পুরো বডিই মেসেজ
  }

  if (req.body && typeof req.body === 'object') {
    const keys = Object.keys(req.body);
    if (keys.length === 1 && !('message' in req.body)) return String(keys[0] ?? '');
  }
  return '';
}

function handleIncoming(req, res) {
  const raw = extractMessage(req);
  const parts = raw ? raw.split('##') : [];

  const record = {
    ts: new Date().toISOString(),
    headers: req.headers,
    body: req.body,
    raw: req.rawBody,
    parsed: raw,
    parts: {
      time: parts[0] || '',
      from: parts[1] || '',
      country: parts[2] || '',
      to: parts[3] || '',
      text: parts.slice(4).join('##') || ''
    }
  };
  received.push(record);
  if (received.length > 200) received.shift();

  // 💡 সবসময় successful পাঠাই যাতে অ্যাপে "Failed: Upload" না আসে
  res.status(200).type('text/plain').send('successful');
}

// নতুন রুট (আপনি যেটা অ্যাপে বসিয়েছেন)
app.post('/sms', handleIncoming);

// ব্যাকওয়ার্ড-কম্প্যাটিবল পুরনো PHP রুটও খুলে দিলাম (যদি কখনো দরকার হয়)
app.post('/android-sms/android-sms.php', handleIncoming);

// ব্রাউজার UI
app.get('/api/messages', (_req, res) => res.json(received.slice().reverse()));
app.delete('/api/messages', (_req, res) => { received.length = 0; res.json({ ok: true }); });

app.use(express.static(path.join(__dirname)));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Server on ${PORT}`));
