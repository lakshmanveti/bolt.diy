import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import type { ProgressAnnotation } from '~/types/context';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { Inspector, type ElementInfo } from '~/components/workbench/Inspector';
import { BuildProgress } from './BuildProgress';
import { ConsumerDeployButton } from './ConsumerDeployButton';

interface AppPreviewProps {
  annotations?: ProgressAnnotation[];
  isStreaming?: boolean;
  setSelectedElement?: (element: ElementInfo | null) => void;
  /** Latest user prompt for wait-state summary on the build panel. */
  promptSummary?: string;
}

/** iPhone 12/13 logical size — simple consumer mobile frame */
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;

const iconBtn = (primary?: boolean, active?: boolean) =>
  classNames(
    'inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors shrink-0',
    primary
      ? 'bg-accent-500 text-white hover:bg-bolt-elements-button-primary-backgroundHover border border-transparent'
      : active
        ? 'border border-accent-500/50 bg-accent-500/15 text-accent-500'
        : 'border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive',
  );

function PreviewToolbar({
  readyPreviews,
  activeIndex,
  setActiveIndex,
  activeBaseUrl,
  onReload,
  mobileView,
  onToggleMobile,
  landscape,
  onToggleLandscape,
  inspectorMode,
  onToggleInspector,
}: {
  readyPreviews: { baseUrl: string; port: number }[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  activeBaseUrl?: string;
  onReload: () => void;
  mobileView: boolean;
  onToggleMobile: () => void;
  landscape: boolean;
  onToggleLandscape: () => void;
  inspectorMode: boolean;
  onToggleInspector: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor shrink-0">
      <span className="text-xs font-medium text-bolt-elements-textSecondary truncate flex-1">Live preview</span>

      <div className="flex items-center gap-1.5 shrink-0">
        <a href="/" className={iconBtn(true)} title="New App" aria-label="New App">
          <div className="i-ph:plus w-4 h-4" />
        </a>

        <ConsumerDeployButton />

        <button
          type="button"
          className={iconBtn()}
          title="Download code (ZIP)"
          aria-label="Download code"
          onClick={() => workbenchStore.downloadZip()}
        >
          <div className="i-ph:download-simple w-4 h-4" />
        </button>

        {readyPreviews.length > 1 && (
          <select
            className="text-xs bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded px-2 py-1.5 text-bolt-elements-textPrimary"
            value={activeIndex}
            onChange={(e) => setActiveIndex(Number(e.target.value))}
          >
            {readyPreviews.map((preview, index) => (
              <option key={preview.baseUrl} value={index}>
                Port {preview.port}
              </option>
            ))}
          </select>
        )}

        {activeBaseUrl && (
          <>
            <button
              type="button"
              className={iconBtn(false, mobileView)}
              title={mobileView ? 'Desktop view' : 'Mobile view'}
              aria-label={mobileView ? 'Desktop view' : 'Mobile view'}
              aria-pressed={mobileView}
              onClick={onToggleMobile}
            >
              <div className={mobileView ? 'i-ph:desktop w-4 h-4' : 'i-ph:device-mobile w-4 h-4'} />
            </button>

            {mobileView && (
              <button
                type="button"
                className={iconBtn(false, landscape)}
                title={landscape ? 'Portrait' : 'Landscape'}
                aria-label={landscape ? 'Portrait' : 'Landscape'}
                aria-pressed={landscape}
                onClick={onToggleLandscape}
              >
                <div className="i-ph:device-rotate w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              className={iconBtn(false, inspectorMode)}
              title={inspectorMode ? 'Stop click-to-edit' : 'Click-to-edit: select an element in the preview'}
              aria-label={inspectorMode ? 'Stop click-to-edit' : 'Click-to-edit'}
              aria-pressed={inspectorMode}
              onClick={onToggleInspector}
            >
              <div className="i-ph:cursor-click w-4 h-4" />
            </button>

            <button type="button" className={iconBtn()} title="Reload" aria-label="Reload" onClick={onReload}>
              <div className="i-ph:arrow-clockwise w-4 h-4" />
            </button>
            <button
              type="button"
              className={iconBtn()}
              title="Open in new tab"
              aria-label="Open in new tab"
              onClick={() => window.open(activeBaseUrl, '_blank')}
            >
              <div className="i-ph:arrow-square-out w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MobileFrame({
  src,
  iframeRef,
  landscape,
}: {
  src: string;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  landscape: boolean;
}) {
  const screenW = landscape ? MOBILE_HEIGHT : MOBILE_WIDTH;
  const screenH = landscape ? MOBILE_WIDTH : MOBILE_HEIGHT;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-auto p-4 sm:p-6">
      <div
        className="relative shrink-0 rounded-[2.25rem] bg-[#111] p-3 shadow-[0_20px_50px_rgba(0,0,0,0.45)] ring-1 ring-white/10"
        style={{
          width: screenW + 24,
          maxWidth: '100%',
        }}
      >
        <div
          className="pointer-events-none absolute z-[2] rounded-full bg-black"
          style={
            landscape
              ? { top: '50%', left: 18, transform: 'translateY(-50%)', width: 8, height: 64 }
              : { top: 18, left: '50%', transform: 'translateX(-50%)', width: 96, height: 28 }
          }
        />

        <div
          className="overflow-hidden rounded-[1.75rem] bg-white"
          style={{
            width: '100%',
            aspectRatio: `${screenW} / ${screenH}`,
            maxHeight: 'min(844px, calc(100vh - 12rem))',
          }}
        >
          <iframe
            ref={iframeRef}
            className="h-full w-full border-none bg-white"
            src={src}
            title="App preview (mobile)"
            allow="cross-origin-isolated"
          />
        </div>

        <div
          className="pointer-events-none absolute z-[2] rounded-full bg-white/25"
          style={
            landscape
              ? { top: '50%', right: 14, transform: 'translateY(-50%)', width: 4, height: 40 }
              : { bottom: 10, left: '50%', transform: 'translateX(-50%)', width: 108, height: 4 }
          }
        />
      </div>
    </div>
  );
}

/**
 * Minimal live-app surface. Uses workbench preview URLs without the IDE Preview chrome.
 * While building, shows a single bold status panel (no duplicate progress in chat).
 */
export const AppPreview = memo(
  ({ annotations = [], isStreaming = false, setSelectedElement, promptSummary }: AppPreviewProps) => {
    const previews = useStore(workbenchStore.previews);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [mobileView, setMobileView] = useState(false);
    const [landscape, setLandscape] = useState(false);
    const [inspectorMode, setInspectorMode] = useState(false);

    const readyPreviews = useMemo(
      () => previews.filter((preview) => preview.ready && Boolean(preview.baseUrl)),
      [previews],
    );

    useEffect(() => {
      if (readyPreviews.length === 0) {
        return;
      }

      if (activeIndex >= readyPreviews.length) {
        setActiveIndex(0);
      }
    }, [readyPreviews, activeIndex]);

    useEffect(() => {
      workbenchStore.currentView.set('preview');
    }, []);

    const postInspectorState = useCallback((active: boolean) => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: 'INSPECTOR_ACTIVATE',
          active,
        },
        '*',
      );
    }, []);

    const handleElementSelect = useCallback(
      (element: ElementInfo) => {
        setSelectedElement?.(element);
        setInspectorMode(false);
        postInspectorState(false);
        toast.info('Element selected — describe the change in chat');
      },
      [postInspectorState, setSelectedElement],
    );

    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'INSPECTOR_READY') {
          postInspectorState(inspectorMode);
        }
      };

      window.addEventListener('message', handleMessage);

      return () => window.removeEventListener('message', handleMessage);
    }, [inspectorMode, postInspectorState]);

    useEffect(() => {
      postInspectorState(inspectorMode);
    }, [inspectorMode, postInspectorState, mobileView]);

    const active = readyPreviews[activeIndex] ?? readyPreviews[0];

    const reload = useCallback(() => {
      if (!iframeRef.current || !active?.baseUrl) {
        return;
      }

      iframeRef.current.src = active.baseUrl;
    }, [active?.baseUrl]);

    const toggleInspector = useCallback(() => {
      setInspectorMode((prev) => {
        const next = !prev;
        postInspectorState(next);

        if (next) {
          toast.info('Click anything in the preview to edit it');
        }

        return next;
      });
    }, [postInspectorState]);

    const toolbar = (
      <PreviewToolbar
        readyPreviews={readyPreviews}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        activeBaseUrl={active?.baseUrl}
        onReload={reload}
        mobileView={mobileView}
        onToggleMobile={() => setMobileView((v) => !v)}
        landscape={landscape}
        onToggleLandscape={() => setLandscape((v) => !v)}
        inspectorMode={inspectorMode}
        onToggleInspector={toggleInspector}
      />
    );

    if (!active) {
      return (
        <div className="flex h-full w-full flex-col bg-bolt-elements-background-depth-1">
          {toolbar}
          <div className="flex flex-1 items-center justify-center px-6 py-10">
            <BuildProgress annotations={annotations} isStreaming={isStreaming} promptSummary={promptSummary} />
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col bg-bolt-elements-background-depth-1">
        {toolbar}
        <div className="relative min-h-0 flex-1">
          {inspectorMode && (
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 rounded-md border border-accent-500/30 bg-accent-500/10 px-3 py-1.5 text-center text-xs text-bolt-elements-textPrimary backdrop-blur-sm">
              Click an element in the app, then describe the change in chat
            </div>
          )}

          {mobileView ? (
            <MobileFrame src={active.baseUrl} iframeRef={iframeRef} landscape={landscape} />
          ) : (
            <iframe
              ref={iframeRef}
              className="h-full w-full border-none bg-white"
              src={active.baseUrl}
              title="App preview"
              allow="cross-origin-isolated"
            />
          )}

          <Inspector isActive={inspectorMode} iframeRef={iframeRef} onElementSelect={handleElementSelect} />
        </div>
      </div>
    );
  },
);
