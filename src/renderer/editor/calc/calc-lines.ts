import type { Mark, Node as PmNode } from '@tiptap/pm/model';
import { Calculator, insertionFor, type CalcOptions } from '../../../shared/calc/calculator';

/** Stands for a chip, an image or a formula in a line: no expression holds one. */
const OBJECT = '￼';

/** The text of an inline leaf: a line break for a hard break, an object otherwise. */
export const leafText = (node: PmNode): string => (node.type.name === 'hardBreak' ? '\n' : OBJECT);

/** A math result written on a line (a run of `calcResult` text) and the line's text before it. */
export interface ResultRun {
  from: number;
  to: number;
  text: string;
  before: string;
  marks: readonly Mark[];
}

/** One line of a text block (lines are separated by hard breaks) and the results on it. */
export interface DocLine {
  text: string;
  results: ResultRun[];
}

const isResult = (mark: Mark) => mark.type.name === 'calcResult';

/** Code blocks and diagrams hold no math (D-188). */
const holdsMath = (block: PmNode) => block.isTextblock && !block.type.spec.code;

/** The lines of a text block whose content starts at `start`. */
export function linesOf(block: PmNode, start: number): DocLine[] {
  const lines: DocLine[] = [{ text: '', results: [] }];
  block.forEach((child, offset) => {
    const line = lines[lines.length - 1]!;
    if (child.isText) {
      const text = child.text ?? '';
      const last = line.results.at(-1);
      if (child.marks.some(isResult)) {
        // Neighbouring text nodes of one result (different formatting) are one result.
        if (last && last.to === start + offset) {
          last.to += text.length;
          last.text += text;
        } else line.results.push({ from: start + offset, to: start + offset + text.length, text, before: line.text, marks: child.marks });
      }
      line.text += text;
    } else if (child.type.name === 'hardBreak') lines.push({ text: '', results: [] });
    else line.text += OBJECT;
  });
  return lines;
}

/** Every math line of a document in order, with the position its block's content starts at. */
function eachLine(doc: PmNode, visit: (line: DocLine) => void): void {
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (holdsMath(node)) for (const line of linesOf(node, pos + 1)) visit(line);
    return false;
  });
}

/** What the variables of a document amount to (Calculator.signature): equal when no definition changed. */
export function definitionsSignature(doc: PmNode, options: CalcOptions): string {
  const calc = new Calculator(options);
  eachLine(doc, (line) => calc.define(line.text));
  return calc.signature();
}

/** A result to show at the caret: where, the text to insert (with its leading space) and the result alone. */
export interface CaretResult {
  pos: number;
  insertion: string;
  result: string;
  /** Identifies what was asked, so Esc dismisses this one and the next "=" asks again. */
  key: string;
}

/**
 * The result for the line at an empty selection (D-188): its text before the caret ends with "=" (and spaces), the
 * rest of the line is blank, and it is not code. The lines above define the variables.
 */
export function caretResult(doc: PmNode, pos: number, marksAtCaret: readonly Mark[], options: CalcOptions): CaretResult | null {
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  if (!holdsMath(block) || marksAtCaret.some((m) => m.type.name === 'code')) return null;
  const start = $pos.start();
  const before = block.textBetween(0, $pos.parentOffset, '\n', leafText).split('\n').at(-1)!;
  if (!/=\s*$/.test(before)) return null;
  const after = block.textBetween($pos.parentOffset, block.content.size, '\n', leafText).split('\n')[0]!;
  if (after.trim() !== '') return null;

  const calc = new Calculator(options);
  let done = false;
  doc.descendants((node, nodePos) => {
    if (done || !node.isTextblock) return !done;
    const lines = holdsMath(node) ? linesOf(node, nodePos + 1) : [];
    if (nodePos + 1 === start) {
      // In the caret's block, only the lines before the caret's line.
      const caretLine = block.textBetween(0, $pos.parentOffset, '\n', leafText).split('\n').length - 1;
      for (const line of lines.slice(0, caretLine)) calc.define(line.text);
      done = true;
    } else for (const line of lines) calc.define(line.text);
    return false;
  });
  const found = calc.suggest(before);
  return found ? { pos, insertion: insertionFor(before, found.text), result: found.text, key: `${pos}:${before}` } : null;
}

/** A result to write again: its range and its new text. */
export interface Recalculation {
  from: number;
  to: number;
  text: string;
  marks: readonly Mark[];
}

/**
 * The marked results that read variables and no longer match them (D-189), top to bottom. Each line's results use the
 * variables defined above the line; a result whose expression has no value now is left as it is.
 */
export function staleResults(doc: PmNode, options: CalcOptions): Recalculation[] {
  const calc = new Calculator(options);
  const stale: Recalculation[] = [];
  eachLine(doc, (line) => {
    for (const run of line.results) {
      const now = calc.resultOf(run.before);
      if (now?.readsVariables && now.text !== run.text) stale.push({ from: run.from, to: run.to, text: now.text, marks: run.marks });
    }
    calc.define(line.text);
  });
  return stale;
}
