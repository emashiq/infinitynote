/** Largest side of a copied PNG, in pixels (the drawing is scaled up for sharpness, D-158). */
const MAX_PNG_SIDE = 4096;
const PNG_SCALE = 2;

/** The drawing's size from its viewBox (Mermaid sets one), else its width and height. */
export function svgSize(svg: string): { width: number; height: number } {
  const view = /viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
  const width = view ? Number(view[1]) : Number(/\swidth="([\d.]+)/.exec(svg)?.[1] ?? 0);
  const height = view ? Number(view[2]) : Number(/\sheight="([\d.]+)/.exec(svg)?.[1] ?? 0);
  return { width: width > 0 ? width : 800, height: height > 0 ? height : 600 };
}

/** The PNG size for a drawing: twice its size, within the largest side. */
export function pngSize(size: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(PNG_SCALE, MAX_PNG_SIDE / Math.max(size.width, size.height));
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/** Draws the SVG on a canvas (with the given background) and returns it as a PNG. */
export async function svgToPng(svg: string, background: string): Promise<Blob> {
  const { width, height } = pngSize(svgSize(svg));
  const image = new Image();
  image.decoding = 'async';
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no png'))), 'image/png'));
}

/** Puts the drawing on the clipboard as SVG (with its markup as text for apps that paste text). */
export async function copySvg(svg: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }), 'text/plain': new Blob([svg], { type: 'text/plain' }) })]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(svg);
      return true;
    } catch {
      return false;
    }
  }
}

export async function copyPng(svg: string, background: string): Promise<boolean> {
  try {
    const png = await svgToPng(svg, background);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
