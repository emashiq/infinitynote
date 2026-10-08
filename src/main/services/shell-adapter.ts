export interface ShellAdapter {
  /** Resolves to an empty string on success, otherwise an error message (Electron shell.openPath semantics). */
  openPath(path: string): Promise<string>;
  /** Opens an http(s) address in the default browser; callers validate it with parseExternalUrl first. */
  openExternal(url: string): Promise<void>;
}
