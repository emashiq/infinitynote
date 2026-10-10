import { readPptx, writePptx, type PptxSourceModel } from '@pptx-glimpse/document';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { MAX_PRESENTATION_SLIDES, PRESENTATION_LIMITS } from '../../../shared/documents/presentation';

/** Why a file does not open in the presentation editor (D-153). */
export type PackageRefusal = 'tooLarge' | 'notPresentation' | 'macros' | 'tooManySlides';

export type ReadResult = { ok: true; model: PptxSourceModel } | { ok: false; reason: PackageRefusal };

/** What a package's content types declare for macros (as main's check, D-143). */
const MACRO_CONTENT_TYPE = /macroEnabled|vbaProject/i;
const MACRO_PART = /(^|\/)vbaProject\.bin$/i;

/**
 * Whether a zip's central directory stays inside the editor's bounds, read without unpacking anything: entry count,
 * unpacked total and the compression ratio of each larger entry. A zip that cannot be read is out of bounds too.
 */
export function withinBounds(bytes: Uint8Array): boolean {
  if (bytes.length > PRESENTATION_LIMITS.maxFileBytes) return false;
  let entries = 0;
  let total = 0;
  let ok = true;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        total += file.originalSize;
        const ratio = file.size === 0 ? Infinity : file.originalSize / file.size;
        if (entries > PRESENTATION_LIMITS.maxEntries || total > PRESENTATION_LIMITS.maxUnpackedBytes) ok = false;
        if (file.originalSize > PRESENTATION_LIMITS.ratioFloorBytes && ratio > PRESENTATION_LIMITS.maxRatio) ok = false;
        return false;
      },
    });
  } catch {
    return false;
  }
  return ok && entries > 0;
}

function declaresMacros(model: PptxSourceModel): boolean {
  const { contentTypes, parts } = model.packageGraph;
  const types = [...contentTypes.defaults.map((d) => d.contentType), ...contentTypes.overrides.map((o) => o.contentType)];
  return types.some((type) => MACRO_CONTENT_TYPE.test(type)) || parts.some((part) => MACRO_PART.test(part.partPath));
}

/**
 * Reads a presentation for editing after the bounds check (D-153). Macro-enabled packages are refused like everywhere
 * else in the app (D-136, D-143), and so is a deck with more slides than the editor shows.
 */
export function readPresentation(bytes: Uint8Array): ReadResult {
  if (!withinBounds(bytes)) return { ok: false, reason: bytes.length > PRESENTATION_LIMITS.maxFileBytes ? 'tooLarge' : 'notPresentation' };
  let model: PptxSourceModel;
  try {
    model = readPptx(bytes);
  } catch {
    return { ok: false, reason: 'notPresentation' };
  }
  if (declaresMacros(model)) return { ok: false, reason: 'macros' };
  if (model.slides.length > MAX_PRESENTATION_SLIDES) return { ok: false, reason: 'tooManySlides' };
  return { ok: true, model };
}

/** The package bytes of a model: untouched parts keep their bytes, edited parts are patched by the library's writer. */
export const writePresentation = (model: PptxSourceModel): Uint8Array => writePptx(model);

/** A model with no pending edits: written and read back, so the library's slide operations accept every slide. */
export const settle = (model: PptxSourceModel): PptxSourceModel => (model.edits?.length ? readPptx(writePptx(model)) : model);

/** A package from its parts; parts not named in `changes` keep their bytes, a null change removes the part. */
export function repack(parts: Record<string, Uint8Array>, changes: ReadonlyMap<string, Uint8Array | null>): Uint8Array {
  const out: Zippable = {};
  for (const [name, data] of Object.entries(parts)) if (!changes.has(name)) out[name] = data;
  for (const [name, data] of changes) if (data) out[name] = data;
  return zipSync(out);
}

/**
 * Applies a change to the written parts of a model and reads the result back (the OOXML layer, D-150): `change`
 * receives every part and returns the parts it replaces or adds.
 */
export function rewriteParts(model: PptxSourceModel, change: (parts: Record<string, Uint8Array>) => ReadonlyMap<string, Uint8Array | null>): PptxSourceModel {
  const parts = unzipSync(writePptx(model));
  return readPptx(repack(parts, change(parts)));
}
