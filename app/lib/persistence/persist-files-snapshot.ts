import type { FileMap } from '~/lib/stores/files';
import { getLocalSnapshot, setSnapshot } from './db';
import { chatId, db } from './useChatHistory';

/**
 * Keep the IndexedDB/Supabase file snapshot in sync with user edits.
 * Reload hydrates the editor from this snapshot — without it, auto-saved
 * Docker files get replaced by the last AI-turn copy.
 */
export async function persistFilesSnapshot(files: FileMap): Promise<void> {
  const id = chatId.get();

  if (!id || !db || Object.keys(files).length === 0) {
    return;
  }

  const existing = await getLocalSnapshot(db, id).catch(() => undefined);

  await setSnapshot(db, id, {
    chatIndex: existing?.chatIndex || '',
    files: { ...existing?.files, ...files },
    summary: existing?.summary,
  });
}
