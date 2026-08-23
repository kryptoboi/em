const http = require('http');
const { Storage } = require('@google-cloud/storage');

const storage = new Storage();
const BUCKET = 'emores';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return; }

  let body = '';
  let tooBig = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 2_000_000) { tooBig = true; req.destroy(); }
  });

  req.on('end', async () => {
    if (tooBig) return;
    try {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }

      const data = JSON.parse(body);
      if (!Array.isArray(data.order) || !data.order.every(k => typeof k === 'string')) {
        throw new Error('order must be an array of strings');
      }

      const payload = JSON.stringify({
        order: data.order,
        mode: typeof data.mode === 'string' ? data.mode : 'manual',
        updatedAt: new Date().toISOString(),
      });

      await storage.bucket(BUCKET).file('order.json').save(payload, {
        contentType: 'application/json; charset=utf-8',
        metadata: { cacheControl: 'no-cache, max-age=0' },
      });

      send(res, 200, { ok: true });
    } catch (err) {
      send(res, 400, { error: err.message });
    }
  });
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log('save-order listening on', port));
