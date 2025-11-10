const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- RAW body ক্যাপচার (কিছু হোস্টে content-type ভুল হলে) ----
app.use((req, res, next) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => (data += chunk));
  req.on('end', () => {
    req.rawBody = data || '';
    next();
  });
});

// ---- form-urlencoded + json + text—সবই হালকা পদ্ধতিতে ধরব ----
app.use(express.urlencoded({ extended: false })); // message=... (অ্যাপ এটাই পাঠায়)
app.use(express.json());                           // ভবিষ্যতে JSON লাগলে
app.use(express.text({ type: '*/*' }));            // text/plain, octet-stream ইত্যাদি

// ইন-মেমরি লগ (সিম্পল; ডেটাবেজ দরকার নেই)
const received = []; // {ts, headers, body, raw, parsed, parts}

// Android অ্যাপ যে payload দেয় তা থেকে মেসেজ বের করা
function extractMessage(req) {
  // 1) নরমাল কেস: form-urlencoded -> req.body.message
  if (req.body && typeof req.body === 'object' && 'message' in req.body) {
    return String(req.body.message ?? '');
  }

  // 2) text/plain / raw body (message=... আকারে)
  if (typeof req.rawBody === 'string' && req.rawBody.trim()) {
    const rb = req.rawBody.trim();

    // 2a) message=... কেস
    try {
      const usp = new URLSearchParams(rb);
      const m = usp.get('message');
      if (m) return String(m);
    } catch (_) {}

    // 2b) JSON কেস
    try {
      const obj = JSON.parse(rb);
      if (obj && typeof obj === 'object' && 'message' in obj) {
        return String(obj.message ?? '');
      }
    } catch (_) {}

    // 2c) একেবারে “মেসেজই পুরো বডি”
    return rb;
  }

  // 3) কিছু হোস্টে পুরো বডি একটাই key হয়ে আসে: { "time##from##...": "" }
  if (req.body && typeof req.body === 'object') {
    const keys = Object.keys(req.body);
    if (keys.length === 1 && !('message' in req.body)) {
      return String(keys[0] ?? '');
    }
  }

  return '';
}

// অ্যাপ যেটাতে POST করবে: https://<your-app>.railway.app/sms
app.post('/sms', (req, res) => {
  const raw = extractMessage(req);

  // parts: time##from##country##to##text
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

  // লগে রাখি (সাইজ সীমা 200)
  received.push(record);
  if (received.length > 200) received.shift();

  // অ্যাপ "successful" দেখলেই OK ধরে — তাই এটিই পাঠাই
  // (না হলে আপনার অ্যাপে "Failed: Upload" দেখা যাবে)
  if (raw) {
    return res.status(200).send('successful');
  } else {
    // মেসেজ না পেলে—ডিবাগের জন্য হেডার/বডি চেক করতে পারবেন
    return res.status(200).send('received but no message');
  }
});

// ব্রাউজারে দেখার জন্য হালকা UI + API
app.get('/api/messages', (_req, res) => {
  res.json(received.slice().reverse()); // নতুনটা আগে
});

app.delete('/api/messages', (_req, res) => {
  received.length = 0;
  res.json({ ok: true });
});

// index.html সার্ভ
app.use(express.static(path.join(__dirname)));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
