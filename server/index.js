/**
 * Blissful Faraday — Standalone production server
 *
 * Serves:
 *   - /api/* routes (via shared api-handler)
 *   - Static files from dist/ (production build)
 *
 * Usage:  node server/index.js          (port 3000)
 *         PORT=4000 node server/index.js (custom port)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiHandler, getActiveDir } from './api-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── MIME types for static files ─────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
};

// ─── Static file serving ─────────────────────────────────────────────────

function serveStatic(req, res) {
  // Only handle GET/HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }

  let urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;

  // Default to index.html
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(distDir, urlPath);
  const resolved = path.resolve(filePath);

  // Security: ensure resolved path is inside distDir
  if (!resolved.startsWith(path.resolve(distDir))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Serve file or SPA fallback
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(resolved).pipe(res);
  } else {
    // SPA fallback — serve index.html for any unmatched path
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found. Have you run `npm run build`?');
    }
  }
}

// ─── HTTP server ─────────────────────────────────────────────────────────

const apiHandler = createApiHandler();

const server = http.createServer((req, res) => {
  // API and userscript routes → handled by shared middleware
  if (req.url.startsWith('/api/') || req.url.startsWith('/userscripts/')) {
    apiHandler(req, res, () => {
      // Fallback: no API route matched
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    });
    return;
  }

  // Everything else → static files
  serveStatic(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Blissful Faraday] Server running on http://0.0.0.0:${PORT}`);
  console.log(`[Blissful Faraday] Scan directory: ${getActiveDir()}`);
});

// ─── Graceful shutdown ───────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[Blissful Faraday] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('[Blissful Faraday] Server closed.');
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => {
    console.error('[Blissful Faraday] Forced exit after shutdown timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
