import { getStyleProperty } from '@tiptap/core';
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import type { TagParseRule } from '@tiptap/pm/model';
import { inkFor, normalizeHexColor } from '../color';
import { fontFamilyFromCss, fontStack, isFontFamilyKey, normalizeFontSize } from './formatting';

/**
 * Character formatting of rich notes (font, size, text color, highlight) on Tiptap's `textStyle` mark. The official
 * extensions keep their commands; their attributes are replaced by validated ones (formatting.ts), so the editor parses
 * and renders only listed fonts and sizes and `#rrggbb` colors, whatever HTML it reads.
 */

/** The raw declaration first (it keeps the author's format), then the browser's reading of it. */
const styleValue = (el: HTMLElement, property: string): string | null => getStyleProperty(el, property) ?? (el.style.getPropertyValue(property) || null);

const parseColor = (el: HTMLElement) => normalizeHexColor(styleValue(el, 'color'));
const parseBackground = (el: HTMLElement) => normalizeHexColor(styleValue(el, 'background-color'));
const parseFontFamily = (el: HTMLElement) => fontFamilyFromCss(styleValue(el, 'font-family'));
const parseFontSize = (el: HTMLElement) => normalizeFontSize(styleValue(el, 'font-size'));

/** Whether a span carries any formatting a note can store. */
function hasTextStyle(el: HTMLElement): boolean {
  return [parseColor, parseBackground, parseFontFamily, parseFontSize].some((parse) => parse(el) !== null);
}

/** Only spans with a storable style become the mark; Tiptap's merging of nested span styles is kept. */
const NoteTextStyle = TextStyle.extend({
  parseHTML() {
    return ((this.parent?.() ?? []) as TagParseRule[]).map((rule) => ({
      ...rule,
      getAttrs: (node: HTMLElement) => (hasTextStyle(node) ? (rule.getAttrs?.(node) ?? null) : false),
    }));
  },
});

const NoteColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          color: {
            default: null,
            parseHTML: parseColor,
            renderHTML: (attrs) => {
              const color = normalizeHexColor(attrs.color);
              return color ? { style: `color: ${color}` } : {};
            },
          },
        },
      },
    ];
  },
});

/** The highlight. Its `data-ink` gives text without its own color the dark or light ink that reads on it. */
const NoteBackgroundColor = BackgroundColor.extend({
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: parseBackground,
            renderHTML: (attrs) => {
              const color = normalizeHexColor(attrs.backgroundColor);
              return color ? { style: `background-color: ${color}`, 'data-ink': inkFor(color) } : {};
            },
          },
        },
      },
    ];
  },
});

/** Stores the option key (formatting.ts) and renders its font stack. */
const NoteFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: parseFontFamily,
            renderHTML: (attrs) => (isFontFamilyKey(attrs.fontFamily) ? { style: `font-family: ${fontStack(attrs.fontFamily)}` } : {}),
          },
        },
      },
    ];
  },
});

const NoteFontSize = FontSize.extend({
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: parseFontSize,
            renderHTML: (attrs) => {
              const size = normalizeFontSize(attrs.fontSize);
              return size ? { style: `font-size: ${size}` } : {};
            },
          },
        },
      },
    ];
  },
});

export const TEXT_STYLE_EXTENSIONS = [NoteTextStyle, NoteColor, NoteBackgroundColor, NoteFontFamily, NoteFontSize];
