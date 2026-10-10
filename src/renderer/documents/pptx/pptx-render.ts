import { renderPptxSourceModelToSvg } from 'pptx-glimpse';
import type { SlideRenderer } from './pptx-session';

/**
 * Slides as SVG documents with pptx-glimpse (D-149). Text is SVG text in the fonts the system has (no font bytes are
 * bundled or fetched); PNG output, the only user of resvg's WebAssembly, is never asked for.
 */
export const renderSlides: SlideRenderer = async (model, slideNumbers) => {
  const report = await renderPptxSourceModelToSvg(model, { slides: [...slideNumbers], textOutput: 'text', skipSystemFonts: true, logLevel: 'off' });
  return new Map(report.slides.map((slide) => [slide.slideNumber, slide.svg]));
};
