// Isolated local fixture server. Never forwards writes to production.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('.');
const fixture = process.env.GALLERY_TEST_OUTPUT;
if (!fixture) throw new Error('Set GALLERY_TEST_OUTPUT to generated test images.');
let mode = 'normal';
let extra = [];
let removed = new Set();
const requests = [];
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.webm': 'video/webm', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    if (url.pathname === '/__test/scenario') { mode = url.searchParams.get('mode') || 'normal'; requests.length = 0; return json({ mode }); }
    if (url.pathname === '/__test/requests') return json(requests);
    if (url.pathname.startsWith('/api/')) requests.push({ method: req.method, url: req.url });
    if (url.pathname === '/api/gallery.php') {
      if (mode === 'error') return json({ error: 'Unavailable' }, 503);
      if (url.searchParams.has('image')) {
        const download = url.searchParams.get('download') === '1';
        const preview = !download && url.searchParams.get('size') === 'preview';
        if (!preview && mode === 'image-error') return json({ error: 'Unavailable' }, 503);
        const data = await fs.readFile(path.join(fixture, preview ? 'preview.jpg' : 'original.jpg'));
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', ...(download ? { 'Content-Disposition': 'attachment; filename="original.jpg"' } : {}) });
        return res.end(data);
      }
      const photos = mode === 'empty' ? [] : [...extra, ...Array.from({ length: 85 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        createdAt: '2026-09-20T12:00:00Z', canDelete: i === 0,
      }))].filter(photo => !removed.has(photo.id)).map(photo => ({ ...photo, src: 'api/gallery.php?image=' + photo.id, previewSrc: 'api/gallery.php?image=' + photo.id + '&size=preview' }));
      return json({ photos });
    }
    if (url.pathname === '/api/photos.php') {
      let body = ''; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body);
      if (req.method === 'DELETE') { removed.add(data.id); return json({ deleted: 1 }); }
      if (req.method === 'POST') {
        extra.unshift(...data.photos.map((_, i) => ({ id: 'upload-' + Date.now() + '-' + i, createdAt: new Date().toISOString(), canDelete: true })));
        return json({ added: data.photos.length, skipped: 0 }, 201);
      }
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep)) return json({}, 403);
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { json({ error: 'Not found' }, 404); }
});
server.listen(5174, '127.0.0.1', () => console.log('Isolated gallery fixtures at http://127.0.0.1:5174'));
