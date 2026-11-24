// Dev-only static server (no dependencies). Usage: node tools/serve.mjs [port] [root] [basePath]
// Serves the app under an optional base path (default /luma/) to verify relative paths
// work from a deployment subdirectory. Service workers require http://localhost or HTTPS.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] || process.env.PORT || 8080);
const root = resolve(process.argv[3] || '.');
const base = (process.argv[4] || '/luma/').replace(/\/?$/, '/');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const ALLOWED_TOP = new Set(['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons', 'assets', '']);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === base.slice(0, -1)) { res.writeHead(302, { Location: base }); res.end(); return; }
    if (!url.pathname.startsWith(base)) { res.writeHead(404); res.end('not found'); return; }
    let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    rel = normalize(rel).replace(/^([/\\])+/, '');
    if (rel.includes('..') || !ALLOWED_TOP.has(rel.split(/[/\\]/)[0])) { res.writeHead(404); res.end('not found'); return; }
    const file = join(root, rel);
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': base });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500); res.end('error');
  }
}).listen(port, () => console.log(`Luma dev server: http://localhost:${port}${base}`));
