import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { EditorPanel } from '~/components/workbench/EditorPanel';
import { workbenchStore } from '~/lib/stores/workbench';

interface ConsumerCodeEditorProps {
  isStreaming?: boolean;
}

export const ConsumerCodeEditor = memo(({ isStreaming = false }: ConsumerCodeEditorProps) => {
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);

  useEffect(() => {
    void workbenchStore.ensureFilesFromDisk();
  }, []);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    void workbenchStore.saveCurrentDocument().catch(() => {
      toast.error('Failed to save file');
    });
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  const hasFiles = Object.values(files).some((entry) => entry?.type === 'file');

  if (!hasFiles) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
        <div className="i-ph:code mb-1 h-8 w-8 text-bolt-elements-textTertiary" />
        <p className="text-sm font-medium text-bolt-elements-textPrimary">No files yet</p>
        <p className="max-w-sm text-xs text-bolt-elements-textSecondary">
          Files appear here once the app is generated. You can edit them and changes save automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 w-full">
      <EditorPanel
        compact
        editorDocument={currentDocument}
        isStreaming={isStreaming}
        selectedFile={selectedFile}
        files={files}
        unsavedFiles={unsavedFiles}
        onFileSelect={onFileSelect}
        onEditorScroll={onEditorScroll}
        onEditorChange={onEditorChange}
        onFileSave={onFileSave}
        onFileReset={onFileReset}
      />
    </div>
  );
});

ConsumerCodeEditor.displayName = 'ConsumerCodeEditor';
