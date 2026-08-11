import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.tsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const CORP = {
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

function extractCssImports(jsSource) {
  const imports = [];
  const cleaned = jsSource.replace(/^\s*import\s+['"]([^'"]+\.css)['"]\s*;?\s*$/gm, (_, cssPath) => {
    imports.push(cssPath);
    return '/* buildlive: css import moved to <link> */';
  });
  return { cleaned, imports };
}

function resolveUrlPath(fromPath, relativePath) {
  if (relativePath.startsWith('/')) {
    return relativePath;
  }

  const fromDir = fromPath.endsWith('/') ? fromPath : fromPath.replace(/\/[^/]*$/, '/');
  return new URL(relativePath, `http://local${fromDir}`).pathname;
}

function send(res, status, headers, body) {
  res.writeHead(status, { ...CORP, ...headers });
  res.end(body);
}

function injectInspector(html) {
  if (html.includes('buildlive-inspector') || html.includes('INSPECTOR_READY')) {
    return html;
  }

  const tag = '<script src="/buildlive-inspector.js"></script>';

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${tag}</body>`);
  }

  return `${html}\n${tag}`;
}

http
  .createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
      let filePath = path.join(root, urlPath);

      if (filePath.endsWith(path.sep) || (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())) {
        filePath = path.join(filePath, 'index.html');
      }

      if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const relPath = `/${path.relative(root, filePath).split(path.sep).join('/')}`;

      if (ext === '.html') {
        let html = fs.readFileSync(filePath, 'utf8');
        const cssHrefs = new Set();
        const scriptRe = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
        let match;

        while ((match = scriptRe.exec(html)) !== null) {
          const scriptPath = match[1].startsWith('/') ? match[1] : resolveUrlPath(relPath, match[1]);
          const absScript = path.join(root, scriptPath.replace(/^\/+/, ''));

          if (!fs.existsSync(absScript)) {
            continue;
          }

          const { imports } = extractCssImports(fs.readFileSync(absScript, 'utf8'));

          for (const rel of imports) {
            cssHrefs.add(resolveUrlPath(scriptPath, rel));
          }
        }

        const links = [...cssHrefs].map((href) => `<link rel="stylesheet" href="${href}">`).join('\n');

        if (links) {
          if (/<head[^>]*>/i.test(html)) {
            html = html.replace(/<head([^>]*)>/i, `<head$1>${links}`);
          } else {
            html = `${links}${html}`;
          }
        }

        send(res, 200, { 'Content-Type': mime['.html'] }, injectInspector(html));
        return;
      }

      if (ext === '.js' || ext === '.mjs') {
        const { cleaned } = extractCssImports(fs.readFileSync(filePath, 'utf8'));
        send(res, 200, { 'Content-Type': mime[ext] }, cleaned);
        return;
      }

      send(res, 200, { 'Content-Type': mime[ext] || 'application/octet-stream' }, fs.readFileSync(filePath));
    } catch (err) {
      send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, String(err));
    }
  })
  .listen(5173, '0.0.0.0', () => {
    console.log('static-server-ready');
  });
