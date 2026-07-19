// ABOUTME: Minimal static file server for production deployment
// ABOUTME: Serves the dist/ directory with SPA fallback, no Vite config needed at runtime

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const PORT = parseInt(process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000', 10);
const DIST_DIR = join(process.cwd(), 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
};

async function serveFile(filePath, res) {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  // Try exact file first
  const filePath = join(DIST_DIR, pathname);
  if (existsSync(filePath) && !filePath.endsWith('/')) {
    const served = await serveFile(filePath, res);
    if (served) return;
  }

  // Try index.html in directory
  const indexPath = join(DIST_DIR, pathname, 'index.html');
  if (existsSync(indexPath)) {
    const served = await serveFile(indexPath, res);
    if (served) return;
  }

  // SPA fallback: serve root index.html
  const fallback = join(DIST_DIR, 'index.html');
  if (existsSync(fallback)) {
    await serveFile(fallback, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Static server running at http://0.0.0.0:${PORT}`);
});
