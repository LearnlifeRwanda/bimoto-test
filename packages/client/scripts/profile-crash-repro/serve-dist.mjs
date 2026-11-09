// PROFILE-RESCUE G1 — static SPA server for the real built bundle
// (packages/client/dist) on :4173, index.html fallback like the
// Capacitor WebView's local server.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const DIST =
  process.env.BIMOTO_DIST || new URL('../../dist', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:4173');
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    try {
      const data = await readFile(join(DIST, path));
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      const html = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    }
  })
  .listen(4173, () => console.log('[serve-dist] :4173'));
