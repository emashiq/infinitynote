export const LINK_COPIED = 'Link copied';
export const LINK_COPY_FAILED = 'The link could not be copied.';

/** Puts text on the clipboard; the app grants its own page only this write permission (D-118). False when refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
