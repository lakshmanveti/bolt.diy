import type { WebContainer } from '@webcontainer/api';
import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { newBoltShellProcess } from '~/utils/shell';
import { coloredText } from '~/utils/terminal';

/**
 * Terminal store — WebContainer jsh is disabled.
 * Docker shell/start go through DockerRuntime.exec / start (ActionRunner).
 */
export class TerminalStore {
  #terminals: Array<{ terminal: ITerminal }> = [];
  #boltTerminal = newBoltShellProcess();

  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(false);

  constructor(_webcontainerPromise: Promise<WebContainer>) {
    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }
  get boltTerminal() {
    return this.#boltTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }
  async attachBoltTerminal(terminal: ITerminal) {
    terminal.write(coloredText.dim('Docker runtime — shell actions use the container via ActionRunner.\n'));
  }

  async attachTerminal(terminal: ITerminal) {
    terminal.write(coloredText.dim('WebContainer shell disabled. Use Docker runtime.\n'));
  }

  onTerminalResize(_cols: number, _rows: number) {
    // no-op without WC processes
  }

  detachTerminal(terminal: ITerminal) {
    this.#terminals = this.#terminals.filter((t) => t.terminal !== terminal);
  }
}
