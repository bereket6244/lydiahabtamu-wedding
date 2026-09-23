import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import http from 'node:http';
const fetch = (url, options = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, { method: options.method || 'GET', headers: options.headers, agent: false }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      const data = Buffer.concat(chunks);
      resolve({ status: res.statusCode, headers: res.headers, json: async () => JSON.parse(data), arrayBuffer: async () => data });
    });
  });
  req.on('error', reject);
  req.end();
});
const php = process.env.PHP_BINARY || 'php';
const args = JSON.parse(process.env.PHP_TEST_ARGS || '[]');
const temp = await mkdtemp(path.join(os.tmpdir(), 'gallery-api-test-'));
let server;
try {
  let source = await readFile('api/gallery.php', 'utf8');
  // Only replace the connection in an isolated copy; exercise the real request
  // handler and its SQL against a disposable database, never the live service.
  source = source.replace(/\$db = new PDO\([\s\S]*?\]\);/, "$db = new PDO('sqlite:' . __DIR__ . '/test.db', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);");
  await writeFile(path.join(temp, 'gallery.php'), source);
  await copyFile('api/gallery-lib.php', path.join(temp, 'gallery-lib.php'));
  await copyFile('assets/couple.jpg', path.join(temp, 'original.jpg'));
  await writeFile(path.join(temp, 'config.php'), '<?php return [];');
  await writeFile(path.join(temp, 'fixture.php'), `<?php
$db = new PDO('sqlite:' . __DIR__ . '/test.db');
if (($argv[1] ?? '') === 'hide') { $db->exec('UPDATE guest_photos SET hidden = 1'); exit; }
$db->exec('CREATE TABLE guest_photos (id TEXT PRIMARY KEY, owner_id TEXT, image_data TEXT, hidden INTEGER, deleted_at TEXT, created_at TEXT)');
$query = $db->prepare('INSERT INTO guest_photos VALUES (?, ?, ?, ?, ?, ?)');
$image = 'data:image/jpeg;base64,' . base64_encode(file_get_contents(__DIR__ . '/original.jpg'));
for ($i = 0; $i < 87; $i++) $query->execute([sprintf('00000000-0000-4000-8000-%012d', $i), 'test-owner', $image, $i === 85 ? 1 : 0, $i === 86 ? '2026-09-20' : null, '2026-09-20 12:00:00']);
`);
  const runFixture = extra => {
    const result = spawnSync(php, [...args, path.join(temp, 'fixture.php'), ...extra], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  runFixture([]);
  server = spawn(php, [...args, '-S', '127.0.0.1:5175', '-t', temp], { stdio: 'ignore' });
  const base = 'http://127.0.0.1:5175/gallery.php';
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { await fetch(base); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert(ready, 'PHP server starts');
  const listing = await (await fetch(base + '?device_id=test-owner')).json();
  assert.equal(listing.photos.length, 85, 'No 80-photo cap; exclude hidden/deleted');
  assert(listing.photos.every(p => p.canDelete && p.previewSrc.includes('size=preview') && !p.src.startsWith('data:')));
  const anonymous = await (await fetch(base)).json();
  assert(anonymous.photos.every(p => !p.canDelete), 'Ownership flags remain private to uploader');
  const id = '00000000-0000-4000-8000-000000000000';
  const original = Buffer.from(await (await fetch(base + '?image=' + id)).arrayBuffer());
  assert.deepEqual(original, await readFile('assets/couple.jpg'), 'Original is byte-for-byte unchanged');
  const download = await fetch(base + '?image=' + id + '&download=1&size=preview');
  assert.equal(download.status, 200);
  assert.equal(download.headers['content-disposition'], 'attachment; filename="yeabsra-christian-' + id + '.jpg"');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), original, 'Download is always the full-resolution original');
  const previewResponse = await fetch(base + '?image=' + id + '&size=preview');
  const preview = Buffer.from(await previewResponse.arrayBuffer());
  const conditional = { headers: { 'If-None-Match': previewResponse.headers.etag } };
  assert.equal(previewResponse.headers['cache-control'], 'private, no-cache');
  const reused = await fetch(base + '?image=' + id + '&size=preview', conditional);
  assert.equal(reused.status, 304, 'Unchanged public previews reuse browser cache');
  assert.equal((await reused.arrayBuffer()).length, 0, 'Revalidation transfers no image bytes');
  assert(preview.length < original.length / 2);
  assert.deepEqual(Buffer.from(await (await fetch(base + '?image=' + id + '&size=preview')).arrayBuffer()), preview, 'Cached preview matches');
  for (const suffix of ['085', '086', '999']) {
    assert.equal((await fetch(base + '?image=00000000-0000-4000-8000-000000000' + suffix)).status, 404);
  }
  assert.equal((await fetch(base + '?image=../../config.php')).status, 400);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  runFixture(['hide']);
  assert.equal((await fetch(base + '?image=' + id + '&download=1')).status, 404, 'Hidden originals cannot be downloaded');
  assert.equal((await fetch(base + '?image=' + id + '&size=preview', conditional)).status, 404, 'Visibility is checked before conditional cache response');
  assert.equal((await fetch(base + '?image=' + id + '&size=preview')).status, 404, 'Hidden photos cannot leak from cache');
  console.log(`API checks passed: 85 public photos, visibility, ownership, originals, cache, invalid IDs, read-only methods. Preview ${preview.length}/${original.length} bytes.`);
} finally {
  if (server) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(temp, { recursive: true, force: true });
}
