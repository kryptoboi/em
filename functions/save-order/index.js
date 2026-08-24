const http = require('http');
const { Storage } = require('@google-cloud/storage');

const storage = new Storage();
const bucket = storage.bucket('emores');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const THUMB_SUFFIX = '_64x64_thumbnail.';

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function checkAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  return !!ADMIN_TOKEN && token === ADMIN_TOKEN;
}

// ── order.json ──────────────────────────────────────────────
async function handleSaveOrder(req, body, res) {
  if (!checkAuth(req)) { send(res, 401, { error: 'unauthorized' }); return; }
  const data = JSON.parse(body);
  if (!Array.isArray(data.order) || !data.order.every(k => typeof k === 'string')) {
    throw new Error('order must be an array of strings');
  }
  const payload = JSON.stringify({
    order: data.order,
    mode: typeof data.mode === 'string' ? data.mode : 'manual',
    updatedAt: new Date().toISOString(),
  });
  await bucket.file('order.json').save(payload, {
    contentType: 'application/json; charset=utf-8',
    metadata: { cacheControl: 'no-cache, max-age=0' },
  });
  send(res, 200, { ok: true });
}

// ── clear orphaned thumbnails ───────────────────────────────
async function handleClearOrphans(req, body, res) {
  if (!checkAuth(req)) { send(res, 401, { error: 'unauthorized' }); return; }

  const [origFiles] = await bucket.getFiles({ prefix: 'emores2/' });
  const validThumbNames = new Set();
  for (const f of origFiles) {
    const base = f.name.split('/').pop();
    const dot = base.lastIndexOf('.');
    if (!base || dot === -1) continue;
    validThumbNames.add(base.slice(0, dot) + THUMB_SUFFIX + base.slice(dot + 1));
  }

  const [thumbFiles] = await bucket.getFiles({ prefix: 'thumbs/' });
  let deleted = 0;
  for (const f of thumbFiles) {
    const base = f.name.split('/').pop();
    if (base && !validThumbNames.has(base)) {
      await f.delete({ ignoreNotFound: true }).catch(() => {});
      deleted++;
    }
  }
  send(res, 200, { ok: true, deleted });
}

// ── texts.json ───────────────────────────────────────────────
async function handleSaveTexts(req, body, res) {
  if (!checkAuth(req)) { send(res, 401, { error: 'unauthorized' }); return; }
  const data = JSON.parse(body);
  if (typeof data.texts !== 'object' || data.texts === null || Array.isArray(data.texts)) {
    throw new Error('texts must be an object');
  }

  const file = bucket.file('texts.json');
  let existing = {};
  try {
    const [buf] = await file.download();
    existing = JSON.parse(buf.toString('utf8')).texts || {};
  } catch (e) { if (e.code !== 404) throw e; }

  const merged = { ...existing, ...data.texts };
  const payload = JSON.stringify({ texts: merged, updatedAt: new Date().toISOString() });
  await file.save(payload, {
    contentType: 'application/json; charset=utf-8',
    metadata: { cacheControl: 'no-cache, max-age=0' },
  });
  send(res, 200, { ok: true });
}

// ── likes.json (public, no token — one increment/decrement per request) ──
async function incrementLike(key, delta) {
  const file = bucket.file('likes.json');
  for (let attempt = 0; attempt < 6; attempt++) {
    let counts = {};
    let generation = 0;
    try {
      const [meta] = await file.getMetadata();
      generation = meta.generation;
      const [buf] = await file.download();
      counts = JSON.parse(buf.toString('utf8')).counts || {};
    } catch (e) { if (e.code !== 404) throw e; }

    const next = Math.max(0, (counts[key] || 0) + delta);
    counts[key] = next;
    const payload = JSON.stringify({ counts, updatedAt: new Date().toISOString() });

    try {
      await file.save(payload, {
        contentType: 'application/json; charset=utf-8',
        metadata: { cacheControl: 'no-cache, max-age=0' },
        preconditionOpts: { ifGenerationMatch: generation },
      });
      return next;
    } catch (e) {
      if (e.code === 412 && attempt < 5) continue;
      throw e;
    }
  }
  throw new Error('too many conflicting likes, try again');
}

async function handleLike(req, body, res) {
  const data = JSON.parse(body);
  const key = typeof data.key === 'string' ? data.key : null;
  if (!key) throw new Error('key required');
  const delta = data.action === 'unlike' ? -1 : 1;

  const [files] = await bucket.getFiles({ prefix: 'emores2/' });
  const known = files.some(f => f.name.split('/').pop() === key);
  if (!known) { send(res, 404, { error: 'unknown key' }); return; }

  const count = await incrementLike(key, delta);
  send(res, 200, { ok: true, count });
}

// ── router ───────────────────────────────────────────────────
const ROUTES = {
  '/save-order': handleSaveOrder,
  '/': handleSaveOrder,        // backwards-compatible default
  '/clear-orphans': handleClearOrphans,
  '/save-texts': handleSaveTexts,
  '/like': handleLike,
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') { send(res, 405, { error: 'method not allowed' }); return; }

  const path = req.url.split('?')[0];
  const handler = ROUTES[path];
  if (!handler) { send(res, 404, { error: 'unknown route' }); return; }

  let body = '';
  let tooBig = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 2_000_000) { tooBig = true; req.destroy(); }
  });

  req.on('end', async () => {
    if (tooBig) return;
    try {
      await handler(req, body, res);
    } catch (err) {
      send(res, 400, { error: err.message });
    }
  });
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log('save-order listening on', port));
