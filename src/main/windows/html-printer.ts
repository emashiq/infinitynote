import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, type WebContents } from 'electron';
import type { HtmlPrinter } from '../portability/note-document';
import type { Logger } from '../services/logger';

/** Margins of an exported PDF, in inches. */
const PDF_MARGIN = 0.6;

/**
 * Exported pages become PDFs and are printed in a window that is never shown (D-163): no preload, JavaScript off, the
 * app's network guard and the page's own policy (no script, no network). The page is a temporary file in the app's data
 * folder, removed when the window closes.
 */
export function createElectronHtmlPrinter(opts: { tmpDir: string; logger: Logger }): HtmlPrinter {
  const withPage = async <T>(html: string, run: (contents: WebContents) => Promise<T>): Promise<T> => {
    await fs.promises.mkdir(opts.tmpDir, { recursive: true });
    const file = path.join(opts.tmpDir, `${randomUUID()}.html`);
    await fs.promises.writeFile(file, html, 'utf8');
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, webviewTag: false },
    });
    try {
      await win.loadFile(file);
      return await run(win.webContents);
    } finally {
      win.destroy();
      await fs.promises.rm(file, { force: true }).catch((err: unknown) => opts.logger.warn(`print: temporary page not removed: ${String(err)}`));
    }
  };
  return {
    toPdf: (html) =>
      withPage(html, async (contents) => {
        const pdf = await contents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: PDF_MARGIN, bottom: PDF_MARGIN, left: PDF_MARGIN, right: PDF_MARGIN }, generateDocumentOutline: true });
        return new Uint8Array(pdf);
      }),
    print: (html) =>
      withPage(
        html,
        (contents) =>
          new Promise<boolean>((resolve) => {
            contents.print({ silent: false, printBackground: true }, (success, reason) => {
              if (!success && reason !== 'cancelled') opts.logger.warn(`print: failed reason=${reason}`);
              resolve(success);
            });
          }),
      ),
  };
}
