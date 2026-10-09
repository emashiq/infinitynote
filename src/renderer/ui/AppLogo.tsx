import logo128 from '../../../resources/brand/logo-128.png';
import logo256 from '../../../resources/brand/logo-256.png';
import logo32 from '../../../resources/brand/logo-32.png';
import logo64 from '../../../resources/brand/logo-64.png';

/** The logo files from resources/brand, smallest first: each serves CSS sizes up to its width at 1x (D-109). */
const LOGOS = [
  { width: 32, src: logo32 },
  { width: 64, src: logo64 },
  { width: 128, src: logo128 },
  { width: 256, src: logo256 },
] as const;

/** The file for a CSS size at 1x and the next one up for high-density screens. */
export function logoSources(size: number): { src: string; srcSet: string } {
  const found = LOGOS.findIndex((l) => l.width >= size);
  const index = found < 0 ? LOGOS.length - 1 : found;
  const one = LOGOS[index]!;
  const two = LOGOS[Math.min(index + 1, LOGOS.length - 1)]!;
  return { src: one.src, srcSet: `${one.src} 1x, ${two.src} 2x` };
}

/** The app logo (bundled by Vite, served from the app itself under the CSP). Decorative: the app name is next to it. */
export function AppLogo({ size, className }: { size: number; className?: string }) {
  const { src, srcSet } = logoSources(size);
  return <img src={src} srcSet={srcSet} width={size} height={size} alt="" className={className} draggable={false} />;
}
