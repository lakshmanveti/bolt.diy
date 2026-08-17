import { workbenchStore } from '~/lib/stores/workbench';
import { extractRelativePath } from '~/utils/diff';

const SKIP_PATH =
  /(?:^|\/)(?:node_modules|\.git|dist|build|\.cache|\.vite)(?:\/|$)|(?:^|\/)(?:\.buildlive-|buildlive-inspector\.js$)/;

const MAX_FILES = 120;
const MAX_FILE_CHARS = 200_000;

export function collectProjectFiles(): Record<string, string> {
  const files = workbenchStore.files.get();
  const collected: Record<string, string> = {};

  for (const [filePath, dirent] of Object.entries(files)) {
    if (dirent?.type !== 'file' || dirent.isBinary || typeof dirent.content !== 'string') {
      continue;
    }

    const relative = extractRelativePath(filePath).replace(/^\/+/, '');

    if (!relative || SKIP_PATH.test(relative)) {
      continue;
    }

    if (dirent.content.length > MAX_FILE_CHARS) {
      continue;
    }

    collected[relative] = dirent.content;

    if (Object.keys(collected).length >= MAX_FILES) {
      break;
    }
  }

  return collected;
}

export function hasSavableAppFiles(files: Record<string, string>): boolean {
  return Boolean(files['package.json'] || files['index.html']);
}
