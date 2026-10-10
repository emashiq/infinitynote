import { BrowserWindow, session, type Session, type WebContents } from 'electron';
import { PRINT_PAGE_SCHEME } from '../../shared/app-identity';
import type { HtmlPrinter } from '../portability/note-document';
import { installNetworkGuard } from '../services/network-guard';
import type { Logger } from '../services/logger';
import { createPrintPages, PRINT_PARTITION, type PrintPages } from './print-pages';

/** Margins of an exported PDF, in inches. */
const PDF_MARGIN = 0.6;

/** The print window's session: in memory, without a cache, behind the network guard, granting no permission. */
function printSession(pages: PrintPages, logger: Logger): Session {
  const ses = session.fromPartition(PRINT_PARTITION, { cache: false });
  installNetworkGuard(ses, { logger });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.protocol.handle(PRINT_PAGE_SCHEME, (request) => pages.respond(request));
  return ses;
}

/**
 * Exported pages become PDFs and are printed in a window that is never shown (D-163): no preload, JavaScript off, the
 * page's own policy (no script, no network). The page never touches the disk (D-176): main holds it in memory and the
 * window's in-memory session serves it by a random token until the PDF is made or the print dialog closes, so a locked
 * note's text is not left in a file when the app stops while the dialog is open.
 */
export function createElectronHtmlPrinter(opts: { logger: Logger }): HtmlPrinter {
  const pages = createPrintPages();
  let ses: Session | null = null;
  const withPage = async <T>(html: string, run: (contents: WebContents) => Promise<T>): Promise<T> => {
    ses ??= printSession(pages, opts.logger);
    const page = pages.add(html);
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { session: ses, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, webviewTag: false },
    });
    try {
      await win.loadURL(page.url);
      return await run(win.webContents);
    } finally {
      page.release();
      win.destroy();
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
