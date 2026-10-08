export interface ShellAdapter {
  /** Resolves to an empty string on success, otherwise an error message (Electron shell.openPath semantics). */
  openPath(path: string): Promise<string>;
}
