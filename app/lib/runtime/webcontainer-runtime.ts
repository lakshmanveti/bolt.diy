import type { WebContainer } from '@webcontainer/api';
import { webcontainer } from '~/lib/webcontainer';
import type { AppRuntime, ExecResult, PreviewInfoEvent } from './types';

/**
 * WebContainer-backed AppRuntime.
 * Wraps the existing boot singleton — behavior identical to pre-M1.
 */
export class WebContainerRuntime implements AppRuntime {
  readonly target = 'webcontainer' as const;

  #wcPromise: Promise<WebContainer>;

  constructor(wcPromise: Promise<WebContainer> = webcontainer) {
    this.#wcPromise = wcPromise;
  }

  /** Escape hatch for stores/ActionRunner still typed against WebContainer (M1 bridge). */
  getWebContainer(): Promise<WebContainer> {
    return this.#wcPromise;
  }

  async ready(): Promise<void> {
    await this.#wcPromise;
  }

  async writeFile(filePath: string, content: string | Uint8Array): Promise<void> {
    const wc = await this.#wcPromise;
    await wc.fs.writeFile(filePath, content);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const wc = await this.#wcPromise;
    const recursive = options?.recursive ?? true;

    if (recursive) {
      await wc.fs.mkdir(dirPath, { recursive: true });
    } else {
      await wc.fs.mkdir(dirPath);
    }
  }

  async readFile(filePath: string, encoding: 'utf8' = 'utf8'): Promise<string> {
    const wc = await this.#wcPromise;
    return wc.fs.readFile(filePath, encoding);
  }

  async exec(command: string): Promise<ExecResult> {
    const wc = await this.#wcPromise;
    const process = await wc.spawn('/bin/jsh', ['-c', command]);
    const output: string[] = [];

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          output.push(data);
        },
      }),
    );

    const exitCode = await process.exit;

    return { exitCode, output: output.join('') };
  }

  onPreview(callback: (preview: PreviewInfoEvent) => void): () => void {
    let disposed = false;
    let unbindPort: (() => void) | undefined;
    let unbindReady: (() => void) | undefined;

    void this.#wcPromise.then((wc) => {
      if (disposed) {
        return;
      }

      unbindPort = wc.on('port', (port, type, url) => {
        callback({
          port,
          ready: type === 'open',
          baseUrl: url,
        });
      });

      unbindReady = wc.on('server-ready', (port, url) => {
        callback({
          port,
          ready: true,
          baseUrl: url,
        });
      });
    });

    return () => {
      disposed = true;
      unbindPort?.();
      unbindReady?.();
    };
  }
}
