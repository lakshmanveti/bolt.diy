/**
 * Parse npm/Vite start logs into a coarse stage for the preview overlay.
 */

export function parseStartLog(log) {
  const text = String(log || '');
  const lines = text.split(/\r?\n/);
  let packageName = null;
  let packagesAdded = null;
  let viteReady = false;
  let sawNpm = false;
  let sawVite = false;
  let error = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      continue;
    }

    if (/\bnpm\b|registry\.npmjs\.org|added \d+ packages/i.test(line)) {
      sawNpm = true;
    }

    if (/\bvite\b/i.test(line) || /Local:\s+https?:\/\//.test(line)) {
      sawVite = true;
    }

    if (/ready in \d+/i.test(line) || /Local:\s+https?:\/\//.test(line)) {
      viteReady = true;
    }

    const added = line.match(/added (\d+) packages/i);

    if (added) {
      packagesAdded = Number(added[1]);
    }

    const fromRegistry = line.match(/registry\.npmjs\.org\/((?:@[^/\s]+\/)?[^/\s"'?]+)/i);

    if (fromRegistry) {
      const name = fromRegistry[1].replace(/\/-\/.*$/, '').replace(/\.tgz$/i, '');

      if (name && !name.startsWith('-')) {
        packageName = decodeURIComponent(name);
      }
    }

    if (/npm ERR!|ELIFECYCLE|Cannot find package|ECONNREFUSED/i.test(line)) {
      error = line.slice(0, 180);
    }
  }

  /** @type {'install' | 'server' | 'ready' | 'error'} */
  let stage = 'install';

  if (error && !viteReady) {
    stage = 'error';
  } else if (viteReady) {
    stage = 'ready';
  } else if (sawVite || packagesAdded != null) {
    stage = 'server';
  } else if (sawNpm || packageName) {
    stage = 'install';
  }

  return {
    stage,
    packageName,
    packagesAdded,
    viteReady,
    error,
    logLength: text.length,
  };
}

export function withInstallProgress(command) {
  return String(command || '').replace(
    /\bnpm install\b(?!\s+--no-audit)/,
    'npm install --no-audit --no-fund --loglevel http',
  );
}
