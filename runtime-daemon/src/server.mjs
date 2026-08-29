import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, rm, access, readdir, copyFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseStartLog, withInstallProgress } from './start-status.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SESSIONS_DIR = path.join(ROOT, '.sessions');
const HOST = process.env.RUNTIME_DAEMON_HOST || '127.0.0.1';
const PORT = Number(process.env.RUNTIME_DAEMON_PORT || 7788);
const IMAGE = process.env.RUNTIME_DOCKER_IMAGE || 'node:22-bookworm';
const CONTAINER_WORKDIR = '/home/project';
const PREVIEW_PORTS = [5173, 3000, 4173, 8080, 5000, 4321];
const START_LOG_FILENAME = '.buildlive-start.log';
const STATIC_SERVER_FILENAME = '.buildlive-static-server.mjs';
const STATIC_SERVER_TEMPLATE = path.join(__dirname, 'static-server.mjs');
const INSPECTOR_SCRIPT_FILENAME = 'buildlive-inspector.js';
const INSPECTOR_SCRIPT_TEMPLATE = path.join(__dirname, 'inspector-script.js');
const SESSION_META_FILENAME = '.buildlive-session.json';

/** @typedef {{
 *  id: string,
 *  chatId: string,
 *  workdir: string,
 *  containerId?: string,
 *  containerName: string,
 *  preview?: { port: number, hostPort: number, url: string, ready: boolean },
 *  lastCommand?: string,
 *  startProcess?: import('node:child_process').ChildProcessWithoutNullStreams,
 *  startStatus?: { stage: string, packageName?: string, packagesAdded?: number, error?: string, startedAt?: number, logLength?: number },
 * }} Session */

/** @type {Map<string, Session>} */
const sessions = new Map();
/** @type {Map<string, string>} chatId → session id */
const sessionsByChatId = new Map();

function sanitizeSessionId(chatId) {
  const cleaned = String(chatId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return cleaned || randomUUID();
}

function containerNameFor(id) {
  return `buildlive-runtime-${id.slice(0, 12)}`;
}

async function writeSessionMeta(session) {
  await writeFile(
    path.join(session.workdir, SESSION_META_FILENAME),
    `${JSON.stringify({ id: session.id, chatId: session.chatId }, null, 2)}\n`,
    'utf8',
  );
}

function registerSession(session) {
  sessions.set(session.id, session);
  if (session.chatId) {
    sessionsByChatId.set(session.chatId, session.id);
  }
}

function findSessionByChatId(chatKey) {
  const sid =
    sessionsByChatId.get(chatKey) || (sessions.has(sanitizeSessionId(chatKey)) ? sanitizeSessionId(chatKey) : null);

  return sid ? sessions.get(sid) : null;
}

async function recoverSessionsFromDisk() {
  let recovered = 0;

  try {
    const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workdir = path.join(SESSIONS_DIR, entry.name);
      const metaPath = path.join(workdir, SESSION_META_FILENAME);
      let meta = { id: entry.name, chatId: entry.name };

      try {
        const raw = await readFile(metaPath, 'utf8');
        meta = { ...meta, ...JSON.parse(raw) };
      } catch {
        // legacy folder without meta — treat folder name as id/chatId
      }

      if (sessions.has(meta.id)) {
        continue;
      }

      /** @type {Session} */
      const session = {
        id: meta.id,
        chatId: meta.chatId || meta.id,
        workdir,
        containerName: containerNameFor(meta.id),
      };
      registerSession(session);
      recovered += 1;
    }
  } catch (err) {
    console.warn('[runtime-daemon] session recovery failed:', err);
  }

  if (recovered) {
    console.log(`[runtime-daemon] recovered ${recovered} session(s) from disk`);
  }
}

async function pruneStaleContainers() {
  const result = await run('docker', ['ps', '-aq', '--filter', 'name=buildlive-runtime-']);
  const ids = result.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const id of ids) {
    await run('docker', ['rm', '-f', id], { timeoutMs: 20_000 });
  }

  if (ids.length) {
    console.log(`[runtime-daemon] pruned ${ids.length} stale runtime container(s)`);
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function run(command, args, options = {}) {
  const { timeoutMs = 45_000, ...spawnOptions } = options;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      ...spawnOptions,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (payload) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        exitCode: 1,
        stdout,
        stderr: stderr || `Timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      finish({ exitCode: 1, stdout, stderr: stderr || err.message });
    });

    child.on('close', (code) => {
      finish({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

/** Serialize work that must not overlap (same session / same container name). */
const locks = new Map();

function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function inspectContainer(nameOrId) {
  const result = await run('docker', ['inspect', '-f', '{{.Id}} {{.State.Running}} {{.State.Status}}', nameOrId], {
    timeoutMs: 15_000,
  });

  if (result.exitCode !== 0) {
    return null;
  }

  const [id, running, status] = result.stdout.trim().split(/\s+/);

  if (!id) {
    return null;
  }

  return { id, running: running === 'true', status: status || '' };
}

async function adoptContainer(session, nameOrId) {
  const info = await inspectContainer(nameOrId);

  if (!info) {
    return null;
  }

  if (!info.running) {
    const started = await run('docker', ['start', info.id], { timeoutMs: 30_000 });

    if (started.exitCode !== 0) {
      return null;
    }
  }

  session.containerId = info.id;
  return { ...info, running: true };
}

let dockerStatusCache = { checkedAt: 0, available: false };
const DOCKER_STATUS_TTL_MS = 20_000;

async function dockerAvailable() {
  const now = Date.now();

  if (now - dockerStatusCache.checkedAt < DOCKER_STATUS_TTL_MS) {
    return dockerStatusCache.available;
  }

  const result = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  dockerStatusCache = {
    checkedAt: now,
    available: result.exitCode === 0,
  };

  return dockerStatusCache.available;
}

async function ensureImage() {
  const inspect = await run('docker', ['image', 'inspect', IMAGE]);
  if (inspect.exitCode === 0) {
    return;
  }
  console.log(`[runtime-daemon] Pulling ${IMAGE}...`);
  const pull = await run('docker', ['pull', IMAGE], { timeoutMs: 300_000 });
  if (pull.exitCode !== 0) {
    throw new Error(`Failed to pull ${IMAGE}: ${pull.stderr || pull.stdout}`);
  }
}

function toContainerPath(relPath) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return path.posix.join(CONTAINER_WORKDIR, normalized);
}

async function ensureSessionContainer(session) {
  return withLock(`container:${session.containerName}`, async () => {
    const current = session.containerId ? await adoptContainer(session, session.containerId) : null;

    if (current) {
      return;
    }

    const byName = await adoptContainer(session, session.containerName);

    if (byName) {
      console.log(
        `[runtime-daemon] Session ${session.id} reused container ${session.containerId.slice(0, 12)}`,
      );
      return;
    }

    await ensureImage();
    setStartStatus(session, { stage: 'container', startedAt: Date.now() });

    const portArgs = PREVIEW_PORTS.flatMap((p) => ['-p', `127.0.0.1::${p}`]);
    const create = await run(
      'docker',
      [
        'run',
        '-d',
        '--name',
        session.containerName,
        '--security-opt',
        'seccomp=unconfined',
        '-w',
        CONTAINER_WORKDIR,
        '-v',
        `${session.workdir}:${CONTAINER_WORKDIR}`,
        ...portArgs,
        IMAGE,
        'sleep',
        'infinity',
      ],
      { timeoutMs: 60_000 },
    );

    if (create.exitCode === 0) {
      session.containerId = create.stdout.trim();
      console.log(`[runtime-daemon] Session ${session.id} container ${session.containerId.slice(0, 12)}`);
      return;
    }

    const conflict = /already in use/i.test(`${create.stderr}${create.stdout}`);

    if (conflict) {
      const reused = await adoptContainer(session, session.containerName);

      if (reused) {
        console.log(
          `[runtime-daemon] Session ${session.id} adopted in-use container ${session.containerId.slice(0, 12)}`,
        );
        return;
      }
    }

    throw new Error(`Failed to start container: ${create.stderr || create.stdout}`);
  });
}

async function dockerExec(session, command, { detach = false, timeoutMs } = {}) {
  await ensureSessionContainer(session);

  const args = ['exec'];
  if (detach) {
    args.push('-d');
  }
  args.push(session.containerId, 'bash', '-lc', command);

  return run('docker', args, timeoutMs ? { timeoutMs } : {});
}

async function ensureHostPorts(session, { refresh = false } = {}) {
  if (!session.containerId) {
    return {};
  }

  const cached =
    session.hostPorts &&
    session.hostPortsFor === session.containerId &&
    Object.keys(session.hostPorts).length > 0;

  if (cached && !refresh) {
    return session.hostPorts;
  }

  const hostPorts = {};

  for (const containerPort of PREVIEW_PORTS) {
    const mapped = await run('docker', ['port', session.containerId, String(containerPort)]);
    if (mapped.exitCode !== 0) {
      continue;
    }

    const line = mapped.stdout.trim().split(/\r?\n/)[0] || '';
    const match = line.match(/:(\d+)\s*$/);
    if (!match) {
      continue;
    }

    hostPorts[containerPort] = Number(match[1]);
  }

  session.hostPorts = hostPorts;
  session.hostPortsFor = session.containerId;
  return hostPorts;
}

async function probePreviewOrigin(originUrl, timeoutMs = 2000) {
  try {
    const res = await fetch(originUrl, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
}

async function resolvePreviewNow(session, { force = false } = {}) {
  if (!session.containerId) {
    return null;
  }

  const stage = session.startStatus?.stage;
  const age = Date.now() - (session.startStatus?.startedAt || 0);

  // Only skip during early npm install. Never skip for "container" — resume used to
  // set that stage and then could not see an already-running Vite.
  if (!force && stage === 'install' && age < 15_000) {
    return session.preview || null;
  }

  if (!force && session.preview?.ready && session.previewProbedAt && Date.now() - session.previewProbedAt < 4000) {
    return session.preview;
  }

  const hostPorts = await ensureHostPorts(session, {
    refresh: force || !session.preview?.ready,
  });
  const preferred = [5173, ...PREVIEW_PORTS.filter((port) => port !== 5173)];
  let fallback = null;

  for (const containerPort of preferred) {
    const hostPort = hostPorts[containerPort];
    if (!hostPort) {
      continue;
    }

    const originUrl = `http://127.0.0.1:${hostPort}`;
    const url = `${originUrl}/`;
    const candidate = { port: containerPort, hostPort, originUrl, url, ready: false };

    if (!fallback) {
      fallback = candidate;
    }

    if (await probePreviewOrigin(originUrl, force ? 2000 : 800)) {
      session.preview = { ...candidate, ready: true };
      session.previewProbedAt = Date.now();
      return session.preview;
    }

    if (containerPort === 5173 && hostPorts[5173] && !force && stage !== 'ready') {
      break;
    }
  }

  session.preview = fallback;
  session.previewProbedAt = Date.now();
  return session.preview;
}

async function resolvePreview(session, options = {}) {
  if (session.previewResolveInflight) {
    return session.previewResolveInflight;
  }

  session.previewResolveInflight = resolvePreviewNow(session, options).finally(() => {
    session.previewResolveInflight = undefined;
  });

  return session.previewResolveInflight;
}

function proxyHeaders() {
  return {
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Access-Control-Allow-Origin': '*',
  };
}

function parseLocalPreviewTarget(target) {
  try {
    const url = new URL(target);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      return null;
    }

    const hostPort = Number(url.port);
    if (!hostPort) {
      return null;
    }

    return { hostPort, pathname: url.pathname || '/', search: url.search || '' };
  } catch {
    return null;
  }
}

function extractCssImports(jsSource) {
  const imports = [];
  const cleaned = jsSource.replace(/^\s*import\s+['"]([^'"]+\.css)['"]\s*;?\s*$/gm, (_, cssPath) => {
    imports.push(cssPath);
    return `/* buildlive: moved css import ${cssPath} to <link> */`;
  });

  return { cleaned, imports };
}

function resolveUrlPath(fromPath, relativePath) {
  if (relativePath.startsWith('/')) {
    return relativePath;
  }

  const fromDir = fromPath.endsWith('/')
    ? fromPath
    : fromPath.replace(/\/[^/]*$/, '/');
  const combined = new URL(relativePath, `http://local${fromDir}`).pathname;

  return combined;
}

async function proxyToHostPort(req, res, hostPort, subPath, search = '') {
  const targetPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
  const targetUrl = `http://127.0.0.1:${hostPort}${targetPath}${search}`;
  const embedPrefix = `/embed/${hostPort}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        Accept: req.headers.accept || '*/*',
      },
      redirect: 'manual',
    });

    const headers = {
      ...proxyHeaders(),
    };

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    headers['Content-Type'] = contentType;

    const location = upstream.headers.get('location');
    if (location) {
      try {
        const loc = new URL(location, `http://127.0.0.1:${hostPort}`);
        if (loc.hostname === '127.0.0.1' || loc.hostname === 'localhost') {
          headers.Location = `http://${HOST}:${PORT}${embedPrefix}${loc.pathname}${loc.search}`;
        } else {
          headers.Location = location;
        }
      } catch {
        headers.Location = location;
      }
    }

    let body = Buffer.from(await upstream.arrayBuffer());

    // Root-absolute URLs (/src/...) ignore <base href>; rewrite under /embed/<port>
    const rewriteRootAbsolute = (text) =>
      text
        .replace(/(\s(?:src|href|action)=["'])\/(?!\/)/gi, `$1${embedPrefix}/`)
        .replace(/url\(\s*['"]?\/(?!\/)/gi, (match) => match.replace('/', `${embedPrefix}/`));

    const isJs =
      contentType.includes('javascript') ||
      /\.(m?jsx?|tsx?)$/i.test(targetPath);

    if (contentType.includes('text/html')) {
      let html = body.toString('utf8');
      const cssHrefs = new Set();

      // Native ES modules cannot import CSS — collect imports from entry scripts
      const scriptRe = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
      let scriptMatch;

      while ((scriptMatch = scriptRe.exec(html)) !== null) {
        const rawSrc = scriptMatch[1];
        const scriptPath = rawSrc.startsWith('/')
          ? rawSrc
          : resolveUrlPath(targetPath === '/' ? '/index.html' : targetPath, rawSrc);

        try {
          const jsRes = await fetch(`http://127.0.0.1:${hostPort}${scriptPath}`);
          if (!jsRes.ok) {
            continue;
          }

          const { imports } = extractCssImports(await jsRes.text());
          for (const rel of imports) {
            cssHrefs.add(resolveUrlPath(scriptPath, rel));
          }
        } catch {
          // ignore
        }
      }

      const linkTags = [...cssHrefs]
        .map((href) => {
          const embedHref = href.startsWith('/') ? `${embedPrefix}${href}` : href;
          return `<link rel="stylesheet" href="${embedHref}">`;
        })
        .join('\n');

      html = rewriteRootAbsolute(html);
      const baseHref = `http://${HOST}:${PORT}${embedPrefix}/`;
      const headInject = `<base href="${baseHref}">${linkTags}`;

      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, `<head$1>${headInject}`);
      } else {
        html = `${headInject}${html}`;
      }

      html = injectInspectorHtml(html);

      body = Buffer.from(html, 'utf8');
      headers['Content-Length'] = String(body.length);
    } else if (isJs) {
      // Strip CSS imports so the browser doesn't try to load .css as a module
      const { cleaned } = extractCssImports(body.toString('utf8'));
      body = Buffer.from(cleaned, 'utf8');
      headers['Content-Type'] = 'text/javascript; charset=utf-8';
      headers['Content-Length'] = String(body.length);
    } else if (contentType.includes('text/css')) {
      const css = rewriteRootAbsolute(body.toString('utf8'));
      body = Buffer.from(css, 'utf8');
      headers['Content-Length'] = String(body.length);
    }

    res.writeHead(upstream.status, headers);
    res.end(body);
  } catch (error) {
    json(res, 502, {
      error: error instanceof Error ? error.message : 'Proxy failed',
    });
  }
}

async function proxyPreviewRequest(req, res, session, subPath) {
  const preview = session.preview?.ready ? session.preview : await resolvePreview(session);

  if (!preview?.hostPort) {
    json(res, 503, { error: 'Preview is not ready for this session' });
    return;
  }

  await proxyToHostPort(req, res, preview.hostPort, subPath, new URL(req.url || '/', `http://${HOST}`).search);
}

async function pathExistsInSession(session, relPath) {
  try {
    await access(path.join(session.workdir, relPath));
    return true;
  } catch {
    return false;
  }
}

const SESSION_SCAFFOLD_NAMES = new Set([
  SESSION_META_FILENAME,
  STATIC_SERVER_FILENAME,
  INSPECTOR_SCRIPT_FILENAME,
  'public',
]);

/** True when the workdir has generated app files, not only daemon scaffold. */
async function sessionHasAppFiles(session) {
  async function walk(dir, depth) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }

      if (depth === 0 && SESSION_SCAFFOLD_NAMES.has(entry.name)) {
        if (entry.isDirectory() && entry.name === 'public') {
          if (await walk(path.join(dir, entry.name), depth + 1)) {
            return true;
          }
        }
        continue;
      }

      if (entry.name === INSPECTOR_SCRIPT_FILENAME) {
        continue;
      }

      if (entry.isFile()) {
        return true;
      }

      if (entry.isDirectory() && depth < 4 && (await walk(path.join(dir, entry.name), depth + 1))) {
        return true;
      }
    }

    return false;
  }

  return walk(session.workdir, 0);
}

async function pruneEmptySessions() {
  const removed = [];

  for (const session of [...sessions.values()]) {
    if (await sessionHasAppFiles(session)) {
      continue;
    }

    await destroySession(session);
    removed.push(session.id);
  }

  return removed;
}

function isStaticSiteCommand(command) {
  return (
    command.includes(STATIC_SERVER_FILENAME) ||
    /\b(python3?|http\.server|npx\s+(--yes\s+)?serve|php\s+-S)\b/.test(command)
  );
}

async function walkFiles(dir, acc = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      await walkFiles(full, acc);
    } else {
      acc.push(full);
    }
  }

  return acc;
}

async function sessionHasJsxOrTsx(session) {
  const files = await walkFiles(session.workdir);
  return files.some((f) => /\.(jsx|tsx)$/i.test(f));
}

function viteConfigSource() {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function buildliveInspector() {
  return {
    name: 'buildlive-inspector',
    transformIndexHtml(html) {
      if (html.includes('buildlive-inspector') || html.includes('INSPECTOR_READY')) {
        return html;
      }
      const tag = '<script src="/${INSPECTOR_SCRIPT_FILENAME}"></script>';
      if (/<\\/body>/i.test(html)) {
        return html.replace(/<\\/body>/i, tag + '</body>');
      }
      return html + '\\n' + tag;
    },
  };
}

/** LLMs often put JSX in .js files; Vite import-analysis rejects that unless we treat .js as JSX. */
function jsAsJsx() {
  return {
    name: 'buildlive-js-as-jsx',
    enforce: 'pre',
    async transform(code, id) {
      if (id.includes('node_modules')) {
        return null;
      }
      const file = id.split('?')[0];
      if (!file.endsWith('.js')) {
        return null;
      }
      const { transformWithEsbuild } = await import('vite');
      return transformWithEsbuild(code, file, { loader: 'jsx', jsx: 'automatic' });
    },
  };
}

export default defineConfig({
  plugins: [jsAsJsx(), react(), buildliveInspector()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ['**/*.bltmp', '**/.buildlive-tmp/**'],
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 100,
      },
    },
    headers: {
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    },
  },
});
`;
}

function injectInspectorHtml(html) {
  if (html.includes('buildlive-inspector') || html.includes('INSPECTOR_READY')) {
    return html;
  }

  const tag = `<script src="/${INSPECTOR_SCRIPT_FILENAME}"></script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${tag}</body>`);
  }

  return `${html}\n${tag}`;
}

async function copyFileIfMissing(src, dest) {
  try {
    await access(dest);
    return false;
  } catch {
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    return true;
  }
}

async function atomicWriteFile(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.bltmp`;
  await writeFile(tmp, data);

  try {
    await rename(tmp, filePath);
  } catch {
    await writeFile(filePath, data);
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function writeFileIfChanged(filePath, content) {
  try {
    const existing = await readFile(filePath, 'utf8');
    if (existing === content) {
      return false;
    }
  } catch {
    // missing
  }

  await atomicWriteFile(filePath, content);
  return true;
}

/** Copy inspector into the app so Docker previews get click-to-select (WC uses setPreviewScript). */
async function ensureInspectorAssets(session) {
  await mkdir(path.join(session.workdir, 'public'), { recursive: true });
  await copyFile(INSPECTOR_SCRIPT_TEMPLATE, path.join(session.workdir, INSPECTOR_SCRIPT_FILENAME));
  await copyFile(INSPECTOR_SCRIPT_TEMPLATE, path.join(session.workdir, 'public', INSPECTOR_SCRIPT_FILENAME));

  const indexPath = path.join(session.workdir, 'index.html');

  try {
    await access(indexPath);
    const html = await readFile(indexPath, 'utf8');
    const next = injectInspectorHtml(html);

    if (next !== html) {
      await writeFile(indexPath, next, 'utf8');
    }
  } catch {
    // no index.html yet
  }
}

async function ensureViteReactScaffold(session) {
  await ensureInspectorAssets(session);

  if (!(await pathExistsInSession(session, 'package.json'))) {
    await writeFile(
      path.join(session.workdir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'buildlive-app',
          private: true,
          type: 'module',
          scripts: {
            dev: 'vite --host 0.0.0.0 --port 5173',
          },
          dependencies: {
            react: '^18.3.1',
            'react-dom': '^18.3.1',
          },
          devDependencies: {
            '@vitejs/plugin-react': '^4.3.4',
            vite: '^5.4.11',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  // Write vite.config only when missing/changed — rewriting it restarts Vite and reloads the iframe.
  // Do not use path-based proxies with Vite (breaks /@react-refresh and /node_modules/*).
  await writeFileIfChanged(path.join(session.workdir, 'vite.config.js'), viteConfigSource());

  const hasAppTsx = await pathExistsInSession(session, 'src/App.tsx');
  const hasAppJsx = await pathExistsInSession(session, 'src/App.jsx');
  const hasMainTsx = await pathExistsInSession(session, 'src/main.tsx');
  const hasMainJsx = await pathExistsInSession(session, 'src/main.jsx');
  const hasIndexHtml = await pathExistsInSession(session, 'index.html');
  const hasNodeModules = await pathExistsInSession(session, 'node_modules');

  if (!hasAppTsx && !hasAppJsx) {
    // Do not invent a placeholder App — empty sessions must wait for generated files.
    return hasNodeModules
      ? 'npm run dev -- --host 0.0.0.0 --port 5173'
      : 'npm install && npm run dev -- --host 0.0.0.0 --port 5173';
  }

  if (!hasMainTsx && !hasMainJsx) {
    const appImport = hasAppTsx ? './App.tsx' : './App.jsx';
    const cssImport = (await pathExistsInSession(session, 'src/index.css')) ? "import './index.css';\n" : '';
    const mainSource = `${cssImport}import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '${appImport}';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;
    await writeFileIfChanged(path.join(session.workdir, 'src', 'main.jsx'), mainSource);
  }

  if (!hasIndexHtml) {
    await writeFileIfChanged(
      path.join(session.workdir, 'index.html'),
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BuildLive App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    );
  }

  if (hasNodeModules) {
    return 'npm run dev -- --host 0.0.0.0 --port 5173';
  }

  return 'npm install && npm run dev -- --host 0.0.0.0 --port 5173';
}

async function ensureStaticServerScript(session) {
  await ensureInspectorAssets(session);
  await copyFile(STATIC_SERVER_TEMPLATE, path.join(session.workdir, STATIC_SERVER_FILENAME));
  return `node ${STATIC_SERVER_FILENAME}`;
}

async function chooseFallbackStart(session) {
  const hasIndex = await pathExistsInSession(session, 'index.html');
  const hasPkg = await pathExistsInSession(session, 'package.json');
  const hasJsx = await sessionHasJsxOrTsx(session);

  // JSX/TSX needs Vite (browsers cannot execute raw JSX)
  if (hasJsx) {
    return ensureViteReactScaffold(session);
  }

  if (hasIndex && !hasPkg) {
    return ensureStaticServerScript(session);
  }

  if (hasPkg) {
    return 'npm run dev -- --host 0.0.0.0 --port 5173';
  }

  if (hasIndex) {
    return ensureStaticServerScript(session);
  }

  return null;
}

function setStartStatus(session, patch) {
  const previous = session.startStatus || {};
  session.startStatus = {
    stage: 'idle',
    startedAt: previous.startedAt || Date.now(),
    ...previous,
    ...patch,
    updatedAt: Date.now(),
  };
}

async function refreshStartStatusFromLog(session) {
  if (session.startLogInflight) {
    return session.startLogInflight;
  }

  session.startLogInflight = (async () => {
    const log = await readStartLog(session);
    const parsed = parseStartLog(log);

    if (parsed.logLength === 0 && session.startStatus?.stage) {
      return session.startStatus;
    }

    setStartStatus(session, {
      stage: parsed.stage,
      packageName: parsed.packageName,
      packagesAdded: parsed.packagesAdded,
      error: parsed.error,
      logLength: parsed.logLength,
    });

    return session.startStatus;
  })().finally(() => {
    session.startLogInflight = undefined;
  });

  return session.startLogInflight;
}

async function startCommand(session, command) {
  const logPath = path.posix.join(CONTAINER_WORKDIR, START_LOG_FILENAME);
  // Source .env so Vite sees VITE_* on boot (it does not pick up .env written after start).
  const sourced = `cd ${JSON.stringify(CONTAINER_WORKDIR)} && set -a && [ -f .env ] && . ./.env && [ -f .env.local ] && . ./.env.local; set +a; ${command}`;
  const wrapped = `nohup bash -lc ${JSON.stringify(sourced)} > ${logPath} 2>&1 &`;
  return dockerExec(session, wrapped, { detach: false });
}

async function readStartLog(session) {
  try {
    const text = await readFile(path.join(session.workdir, START_LOG_FILENAME), 'utf8');
    const lines = text.split(/\r?\n/);
    const sliced = lines.slice(-120).join('\n').trim();

    if (sliced) {
      return sliced;
    }
  } catch {
    // bind-mount file not created yet
  }

  const age = Date.now() - (session.startStatus?.startedAt || 0);

  if (age < 8_000) {
    return '';
  }

  const result = await dockerExec(
    session,
    `tail -n 120 ${JSON.stringify(`${CONTAINER_WORKDIR}/${START_LOG_FILENAME}`)} /tmp/buildlive-start.log 2>/dev/null || true`,
    { timeoutMs: 3_000 },
  );

  return (result.stdout || '').trim();
}

async function waitForPreview(session, attempts = 30, delayMs = 700) {
  let preview = null;
  let lastLogLength = 0;
  let idleRounds = 0;
  const hardMax = Math.max(attempts, 720);

  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const status = await refreshStartStatusFromLog(session);
    const logLength = status?.logLength || 0;

    if (logLength > lastLogLength) {
      lastLogLength = logLength;
      idleRounds = 0;
    } else {
      idleRounds += 1;
    }

    // Don't docker-port/HTTP-probe while npm is still installing.
    if (status?.stage === 'install' || status?.stage === 'container') {
      if (status?.stage === 'install' && idleRounds < 25 && i >= attempts - 2 && attempts < hardMax) {
        attempts += 1;
      }
      continue;
    }

    preview = await resolvePreview(session);
    if (preview?.ready) {
      setStartStatus(session, { stage: 'ready', error: null });
      return preview;
    }

    if (status?.stage === 'install' && idleRounds < 25 && i >= attempts - 2 && attempts < hardMax) {
      attempts += 1;
    }
  }

  return preview;
}

function invalidatePreview(session) {
  session.previewProbedAt = 0;
  if (session.preview) {
    session.preview = { ...session.preview, ready: false };
  }
}

async function stopAppProcesses(session) {
  invalidatePreview(session);
  await dockerExec(session, "bash -lc 'pkill -9 -f \"vite|next|react-scripts|buildlive-static-server|http.server\" 2>/dev/null || true'");
  await dockerExec(session, "bash -lc 'pkill -9 -x node 2>/dev/null || true'");
  await dockerExec(session, "bash -lc 'for p in 5173 3000 4173 8080 5000 4321; do (command -v fuser >/dev/null 2>&1 && fuser -k ${p}/tcp >/dev/null 2>&1) || true; done'");
  await dockerExec(session, 'sleep 0.2');
}

/**
 * Restart the already-synced app (follow-up edits). Does not rewrite scaffolds.
 * Vite keeps a transform cache in memory; iframe reload alone will not pick up bind-mount writes.
 */
async function restartSession(session) {
  await ensureSessionContainer(session);

  let command = session.lastCommand;

  if (!command) {
    command = await chooseFallbackStart(session);
  }

  if (!command) {
    return { ok: false, error: 'No start command for session', preview: null };
  }

  await stopAppProcesses(session);
  await writeFileIfChanged(path.join(session.workdir, 'vite.config.js'), viteConfigSource());
  setStartStatus(session, { stage: 'server', startedAt: Date.now(), error: null });
  // Flush host bind-mount writes into the container before Node boots (Windows Docker can lag).
  await dockerExec(session, 'sync || true');
  await dockerExec(session, 'sleep 0.5');
  await startCommand(session, command);
  session.lastCommand = command;
  const preview = await waitForPreview(session, 8, 400);

  return {
    ok: true,
    pending: !preview?.ready,
    command,
    preview,
  };
}

async function createSession(chatId) {
  const id = sanitizeSessionId(chatId);

  return withLock(`session:${id}`, async () => {
    const existingId = sessionsByChatId.get(chatId) || (sessions.has(id) ? id : null);

    if (existingId && sessions.has(existingId)) {
      const existing = sessions.get(existingId);
      await ensureSessionContainer(existing);
      return existing;
    }

    // Resume from an on-disk workdir created in a previous daemon process
    const workdir = path.join(SESSIONS_DIR, id);
    try {
      await access(workdir);
      /** @type {Session} */
      const revived = {
        id,
        chatId: chatId || id,
        workdir,
        containerName: containerNameFor(id),
      };
      registerSession(revived);
      await writeSessionMeta(revived);
      await ensureSessionContainer(revived);
      console.log(`[runtime-daemon] resumed session ${id} from disk`);
      return revived;
    } catch {
      // create fresh
    }

    await mkdir(workdir, { recursive: true });

    /** @type {Session} */
    const session = {
      id,
      chatId: chatId || id,
      workdir,
      containerName: containerNameFor(id),
    };

    registerSession(session);
    await writeSessionMeta(session);
    await ensureSessionContainer(session);
    return session;
  });
}

async function destroySession(session) {
  if (session.containerId) {
    await run('docker', ['rm', '-f', session.containerId]);
  } else {
    await run('docker', ['rm', '-f', session.containerName]);
  }

  try {
    await rm(session.workdir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  sessionsByChatId.delete(session.chatId);
  sessions.delete(session.id);
  console.log(`[runtime-daemon] destroyed session ${session.id}`);
}

async function destroySessionByChatId(chatKey) {
  let session = findSessionByChatId(chatKey);

  if (!session) {
    const id = sanitizeSessionId(chatKey);
    const workdir = path.join(SESSIONS_DIR, id);

    try {
      await access(workdir);
      session = {
        id,
        chatId: chatKey || id,
        workdir,
        containerName: containerNameFor(id),
      };
      registerSession(session);
    } catch {
      return { destroyed: false, id: null };
    }
  }

  const { id } = session;
  await destroySession(session);
  return { destroyed: true, id };
}

async function softStartSession(session) {
  await ensureInspectorAssets(session);

  const hasNodeModules = await pathExistsInSession(session, 'node_modules');
  const hasPkg = await pathExistsInSession(session, 'package.json');
  const hasIndex = await pathExistsInSession(session, 'index.html');
  const hasJsx = await sessionHasJsxOrTsx(session);

  let command = null;

  if (hasJsx || hasPkg) {
    if (hasJsx) {
      command = await ensureViteReactScaffold(session);
    } else if (hasNodeModules) {
      command = 'npm run dev -- --host 0.0.0.0 --port 5173';
    } else {
      command = 'npm install && npm run dev -- --host 0.0.0.0 --port 5173';
    }
  } else if (hasIndex) {
    command = await ensureStaticServerScript(session);
  } else {
    return { command: null, preview: null };
  }

  command = withInstallProgress(command);
  const needsInstall = /\bnpm install\b/.test(command);
  setStartStatus(session, {
    stage: needsInstall ? 'install' : 'server',
    packageName: null,
    packagesAdded: null,
    error: null,
    startedAt: Date.now(),
  });

  await stopAppProcesses(session);
  await startCommand(session, command);
  session.lastCommand = command;
  const preview = await waitForPreview(session, 24, 500);
  return { command, preview };
}

/**
 * Attach to an existing project: return live preview if up, otherwise soft-start.
 * This is what a chat page reload does — first-generate waits should use the same path.
 */
async function resumeSession(session) {
  await ensureSessionContainer(session);

  const hasNodeModules = await pathExistsInSession(session, 'node_modules');
  const hasFiles = await sessionHasAppFiles(session);

  // Force an HTTP probe even if start-status still says "server" / "container".
  let preview = await resolvePreview(session, { force: true });

  if (preview?.ready) {
    setStartStatus(session, { stage: 'ready', error: null });
    return {
      resumed: true,
      softStarted: false,
      hasNodeModules,
      hasFiles,
      preview,
    };
  }

  if (!hasFiles) {
    return {
      resumed: false,
      softStarted: false,
      hasNodeModules,
      hasFiles: false,
      preview: null,
    };
  }

  const { command, preview: started } = await softStartSession(session);

  return {
    resumed: Boolean(started?.ready),
    softStarted: Boolean(command),
    hasNodeModules,
    hasFiles: true,
    preview: started,
    command,
  };
}

function withHostFlag(command) {
  // Ensure Vite/webpack-style servers bind for Docker port publishing
  if (/\bvite\b/.test(command) && !/--host\b/.test(command)) {
    return `${command} --host 0.0.0.0`;
  }
  if (/\bnext\b/.test(command) && !/-H\b|--hostname\b/.test(command)) {
    return `${command} -H 0.0.0.0`;
  }
  return command;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      json(res, 204, {});
      return;
    }

    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const { pathname } = url;

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const docker = await dockerAvailable();
      const sessionList = [];
      let emptyCount = 0;

      for (const s of sessions.values()) {
        const hasApp = await sessionHasAppFiles(s);
        if (!hasApp) {
          emptyCount += 1;
        }
        sessionList.push({
          id: s.id,
          chatId: s.chatId,
          preview: s.preview || null,
          empty: !hasApp,
        });
      }

      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BuildLive Runtime Daemon</title>
  <style>
    :root { color-scheme: dark light; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { max-width: 44rem; margin: 3rem auto; padding: 0 1.25rem; line-height: 1.5; }
    code { background: rgba(127,127,127,.15); padding: .1rem .35rem; border-radius: .25rem; }
    .ok { color: #16a34a; } .bad { color: #dc2626; } .muted { color: #888; }
    ul { padding-left: 1.2rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid rgba(127,127,127,.25); }
    button { cursor: pointer; padding: 0.4rem 0.75rem; border-radius: 0.35rem; }
  </style>
</head>
<body>
  <h1>BuildLive runtime daemon</h1>
  <p>Status: <strong class="${docker ? 'ok' : 'bad'}">${docker ? 'healthy' : 'Docker unavailable'}</strong></p>
  <p>This is an API for BuildLive (Preview runtime → Docker), not a website for your generated app.</p>
  <ul>
    <li>Health: <a href="/health"><code>/health</code></a></li>
    <li>Listening: <code>http://${HOST}:${PORT}</code></li>
    <li>Image: <code>${IMAGE}</code></li>
    <li>Sessions on disk: <code>${sessions.size}</code> (${emptyCount} empty)</li>
  </ul>
  <p class="muted">A row with preview “—” is usually a <em>cold</em> session (files on disk, container not running). Empty means no generated app files — only daemon scaffold.</p>
  <p>
    <button type="button" id="prune-empty">Remove empty sessions</button>
  </p>
  <h2>Sessions</h2>
  ${
    sessionList.length === 0
      ? '<p>No active sessions yet. Build an app with Docker selected in Features.</p>'
      : `<table><thead><tr><th>Session</th><th>Preview</th></tr></thead><tbody>${sessionList
          .map((s) => {
            const preview = s.preview?.ready
              ? `<a href="${s.preview.url}" target="_blank" rel="noreferrer">${s.preview.url}</a>`
              : s.empty
                ? '<span class="muted">empty</span>'
                : '<span class="muted">on disk</span>';
            return `<tr><td><code>${s.id.slice(0, 8)}</code></td><td>${preview}</td></tr>`;
          })
          .join('')}</tbody></table>`
  }
  <script>
    document.getElementById('prune-empty')?.addEventListener('click', async () => {
      const button = document.getElementById('prune-empty');
      button.disabled = true;
      try {
        const res = await fetch('/sessions/prune-empty', { method: 'POST' });
        const data = await res.json();
        alert('Removed ' + (data.count || 0) + ' empty session(s)');
        location.reload();
      } catch (err) {
        alert('Prune failed');
        button.disabled = false;
      }
    });
  </script>
</body>
</html>`;
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      const docker = await dockerAvailable();
      json(res, 200, {
        ok: true,
        docker,
        image: IMAGE,
        sessions: sessions.size,
      });
      return;
    }

    const embedMatch = pathname.match(/^\/embed\/(\d+)(?:\/(.*))?$/);
    if (embedMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const hostPort = Number(embedMatch[1]);
      const subPath = embedMatch[2] != null && embedMatch[2] !== '' ? `/${embedMatch[2]}` : '/';
      await proxyToHostPort(req, res, hostPort, subPath, url.search);
      return;
    }

    const proxyMatch = pathname.match(/^\/proxy\/([^/]+)(?:\/(.*))?$/);
    if (proxyMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      const session = sessions.get(proxyMatch[1]);
      if (!session) {
        json(res, 404, { error: 'Session not found' });
        return;
      }

      const subPath = proxyMatch[2] != null && proxyMatch[2] !== '' ? `/${proxyMatch[2]}` : '/';
      await proxyPreviewRequest(req, res, session, subPath);
      return;
    }

    if (req.method === 'POST' && pathname === '/sessions/prune-empty') {
      const removed = await pruneEmptySessions();
      console.log(`[runtime-daemon] pruned ${removed.length} empty session(s)`);
      json(res, 200, { ok: true, removed, count: removed.length });
      return;
    }

    if (req.method === 'POST' && pathname === '/sessions') {
      const body = await readBody(req);
      if (!(await dockerAvailable())) {
        json(res, 503, { error: 'Docker is not available. Start Docker Desktop and retry.' });
        return;
      }
      const chatId = String(body.chatId || '').trim() || randomUUID();
      const session = await createSession(chatId);
      const preview = session.preview?.ready ? session.preview : await resolvePreview(session);
      json(res, 201, {
        id: session.id,
        chatId: session.chatId,
        workdir: session.workdir,
        containerId: session.containerId,
        preview: preview || null,
        reused: sessionsByChatId.get(chatId) === session.id,
      });
      return;
    }

    // GET|DELETE /sessions/by-chat/:chatId — lookup / destroy without creating
    const byChatMatch = pathname.match(/^\/sessions\/by-chat\/([^/]+)$/);
    if (byChatMatch && (req.method === 'GET' || req.method === 'DELETE')) {
      const chatKey = decodeURIComponent(byChatMatch[1]);

      if (req.method === 'DELETE') {
        const result = await destroySessionByChatId(chatKey);
        json(res, 200, { ok: true, ...result });
        return;
      }

      const session = findSessionByChatId(chatKey);

      if (!session) {
        json(res, 404, { error: 'Session not found for chat' });
        return;
      }

      const preview = session.preview?.ready ? session.preview : await resolvePreview(session);
      json(res, 200, {
        id: session.id,
        chatId: session.chatId,
        preview: preview || null,
        hasNodeModules: await pathExistsInSession(session, 'node_modules'),
      });
      return;
    }

    const sessionMatch = pathname.match(
      /^\/sessions\/([^/]+)(?:\/(files|exec|start-status|start|preview|resume|restart))?$/,
    );
    if (!sessionMatch) {
      notFound(res);
      return;
    }

    const sessionId = sessionMatch[1];
    const action = sessionMatch[2];
    const session = sessions.get(sessionId);

    if (!session) {
      json(res, 404, { error: 'Session not found' });
      return;
    }

    if (req.method === 'DELETE' && !action) {
      await destroySession(session);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && action === 'start-status') {
      await refreshStartStatusFromLog(session).catch(() => undefined);
      json(res, 200, session.startStatus || { stage: 'idle' });
      return;
    }

    if (req.method === 'PUT' && action === 'files') {
      const body = await readBody(req);
      const files = body.files || {};

      if (body.path != null && body.content != null) {
        files[body.path] = body.content;
      }

      for (const [relPath, content] of Object.entries(files)) {
        const normalized = String(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
        const abs = path.join(session.workdir, normalized);
        const data =
          typeof content === 'string'
            ? content
            : Buffer.from(content.data || '', content.encoding === 'base64' ? 'base64' : 'utf8');
        await atomicWriteFile(abs, data);
      }

      // Ensure container exists so volume is mounted
      await ensureSessionContainer(session);
      json(res, 200, { ok: true, count: Object.keys(files).length });
      return;
    }

    if (req.method === 'POST' && action === 'exec') {
      const body = await readBody(req);
      const command = String(body.command || '').trim();
      if (!command) {
        json(res, 400, { error: 'command is required' });
        return;
      }

      const result = await dockerExec(session, command);
      json(res, 200, {
        exitCode: result.exitCode,
        output: `${result.stdout}${result.stderr}`.trim(),
      });
      return;
    }

    if (req.method === 'POST' && action === 'start') {
      const body = await readBody(req);
      let command = String(body.command || '').trim();
      if (!command) {
        json(res, 400, { error: 'command is required' });
        return;
      }

      // Prefer an already-running preview (chat reopen / duplicate start)
      if (body.resume !== false) {
        await ensureInspectorAssets(session);
        const existing = await resolvePreview(session);
        if (existing?.ready) {
          json(res, 200, {
            ok: true,
            resumed: true,
            command: null,
            preview: existing,
          });
          return;
        }
      }

      await ensureInspectorAssets(session);

      command = withHostFlag(command);

      // Choose the right runner: Vite for JSX/TSX, static server for plain HTML
      const hasPkg = await pathExistsInSession(session, 'package.json');
      const hasIndex = await pathExistsInSession(session, 'index.html');
      const hasJsx = await sessionHasJsxOrTsx(session);
      const hasNodeModules = await pathExistsInSession(session, 'node_modules');

      if (hasJsx) {
        command = await ensureViteReactScaffold(session);
        console.log(`[runtime-daemon] JSX/TSX app → ${command}`);
      } else if (!hasPkg && hasIndex && /\b(npm|pnpm|yarn|vite|next)\b/.test(command)) {
        command = await ensureStaticServerScript(session);
        console.log(`[runtime-daemon] static site detected → ${command}`);
      } else if (hasPkg && hasNodeModules && /\bnpm install\b/.test(command)) {
        // Skip redundant install when deps already present
        command = command.replace(/\bnpm install\s*&&\s*/g, '');
        console.log(`[runtime-daemon] skip npm install (node_modules present) → ${command}`);
      }

      await stopAppProcesses(session);

      command = withInstallProgress(command);
      const needsInstall = /\bnpm install\b/.test(command);
      setStartStatus(session, {
        stage: needsInstall ? 'install' : 'server',
        packageName: null,
        packagesAdded: null,
        error: null,
        startedAt: Date.now(),
      });

      console.log(`[runtime-daemon] start session=${session.id} cmd=${command}`);
      let result = await startCommand(session, command);
      if (result.exitCode !== 0) {
        json(res, 500, {
          error: 'Failed to start command',
          output: `${result.stdout}${result.stderr}`.trim(),
        });
        return;
      }

      // Return immediately. Client waits on GET /start-status (host log) then one GET /preview.
      let preview = await waitForPreview(session, 8, 400);

      if (!preview?.ready) {
        const log = await readStartLog(session);
        const parsed = parseStartLog(log);
        const fallback = await chooseFallbackStart(session);

        if (parsed.error && fallback && fallback !== command) {
          console.log(`[runtime-daemon] fallback start session=${session.id} cmd=${fallback}`);
          await stopAppProcesses(session);
          command = withInstallProgress(fallback);
          await startCommand(session, command);
          preview = await waitForPreview(session, 8, 400);
        }
      }

      session.lastCommand = command;
      json(res, 200, {
        ok: true,
        pending: !preview?.ready,
        command,
        preview: preview || null,
      });
      return;
    }

    if (req.method === 'POST' && action === 'restart') {
      console.log(`[runtime-daemon] restart session=${session.id}`);
      const result = await restartSession(session);

      if (!result.ok) {
        json(res, 500, {
          error: result.error || 'Preview restart failed',
          preview: result.preview,
          command: result.command,
        });
        return;
      }

      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && action === 'resume') {
      const result = await resumeSession(session);
      json(res, result.resumed || result.softStarted ? 200 : 200, {
        ok: true,
        ...result,
      });
      return;
    }

    if (req.method === 'GET' && action === 'preview') {
      await refreshStartStatusFromLog(session).catch(() => undefined);
      const stage = session.startStatus?.stage;
      const startedAt = session.startStatus?.startedAt || 0;
      const earlyInstall = stage === 'install' && Date.now() - startedAt < 15_000;

      if (earlyInstall) {
        json(res, 200, { preview: session.preview || null });
        return;
      }

      const force = stage === 'server' || stage === 'ready' || stage === 'error' || stage === 'container';
      const preview = await resolvePreview(session, { force });
      json(res, 200, { preview });
      return;
    }

    if (req.method === 'GET' && !action) {
      json(res, 200, {
        id: session.id,
        chatId: session.chatId,
        containerId: session.containerId,
        preview: session.preview || null,
      });
      return;
    }

    notFound(res);
  } catch (error) {
    console.error('[runtime-daemon]', error);
    json(res, 500, {
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
});

await mkdir(SESSIONS_DIR, { recursive: true });
await pruneStaleContainers();
await recoverSessionsFromDisk();

server.listen(PORT, HOST, () => {
  console.log(`[runtime-daemon] listening on http://${HOST}:${PORT}`);
  console.log(`[runtime-daemon] image=${IMAGE} sessionsDir=${SESSIONS_DIR}`);
});
