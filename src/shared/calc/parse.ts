import { FUNCTIONS, type DateLiteral, type Token } from './tokenize';
import { CalcError, unitOf, type DurationUnit } from './values';

export type BinaryOperator = '+' | '-' | '*' | '/' | '^' | 'mod' | 'of';
export type DateWord = 'today' | 'tomorrow' | 'yesterday' | 'now';

export type Expr =
  | { type: 'number'; value: number }
  | { type: 'constant'; name: 'pi' | 'e' }
  | { type: 'date'; date: DateLiteral }
  | { type: 'dateWord'; word: DateWord }
  | { type: 'variable'; name: string }
  | { type: 'negate'; operand: Expr }
  | { type: 'percent'; operand: Expr }
  /** `3 days`: a number of a unit. */
  | { type: 'duration'; operand: Expr; unit: DurationUnit }
  /** `… in weeks`: a duration in another unit. */
  | { type: 'convert'; operand: Expr; unit: DurationUnit }
  | { type: 'binary'; op: BinaryOperator; left: Expr; right: Expr }
  | { type: 'call'; name: string; args: Expr[] };

const CONSTANTS: ReadonlySet<string> = new Set(['pi', 'e']);
const DATE_WORDS: ReadonlySet<string> = new Set(['today', 'tomorrow', 'yesterday', 'now']);
const OPERATOR_WORDS: ReadonlySet<string> = new Set(['mod', 'of', 'in']);
const MONTH_WORDS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$/;

/** Words that are not variable names: keywords, constants, functions, units and month names. */
export function isReservedWord(word: string): boolean {
  const w = word.toLowerCase();
  return CONSTANTS.has(w) || DATE_WORDS.has(w) || OPERATOR_WORDS.has(w) || FUNCTIONS.has(w) || unitOf(w) !== null || MONTH_WORDS.test(w);
}

/** Binding power: conversion, then + -, then * / mod of, then signs, then ^, then % and units. */
const BP = { convert: 5, add: 10, multiply: 20, prefix: 30, power: 40, postfix: 50 } as const;
const MAX_DEPTH = 64;

/**
 * A Pratt parser for note math (D-188): standard precedence, `^` to the right (`-2^2` is -4), postfix `%` and units,
 * `of` for percentages, `in <unit>` for durations. No code is ever run: the result is a tree for `evaluate`.
 */
export function parse(tokens: readonly Token[]): Expr {
  let at = 0;
  let depth = 0;
  const peek = (): Token | undefined => tokens[at];
  const next = (): Token => {
    const token = tokens[at++];
    if (!token) throw new CalcError('The expression ends too early');
    return token;
  };
  const expect = (type: ')'): void => {
    if (next().type !== type) throw new CalcError(`Expected ${type}`);
  };

  const prefix = (token: Token): Expr => {
    switch (token.type) {
      case 'number':
        return { type: 'number', value: token.value };
      case 'date':
        return { type: 'date', date: token.date };
      case '(': {
        const inner = expression(0);
        expect(')');
        return inner;
      }
      case 'op':
        if (token.op === '-') return { type: 'negate', operand: expression(BP.prefix) };
        if (token.op === '+') return expression(BP.prefix);
        throw new CalcError(`Unexpected ${token.op}`);
      case 'word':
        return word(token.word);
      default:
        throw new CalcError(`Unexpected ${token.type}`);
    }
  };

  const word = (name: string): Expr => {
    if (FUNCTIONS.has(name)) {
      if (peek()?.type !== '(') throw new CalcError(`${name} needs parentheses`);
      next();
      const args = [expression(0)];
      while (peek()?.type === ',') {
        next();
        args.push(expression(0));
      }
      expect(')');
      return { type: 'call', name, args };
    }
    if (CONSTANTS.has(name)) return { type: 'constant', name: name as 'pi' | 'e' };
    if (DATE_WORDS.has(name)) return { type: 'dateWord', word: name as DateWord };
    if (isReservedWord(name)) throw new CalcError(`Unexpected ${name}`);
    return { type: 'variable', name };
  };

  /** How strongly the next token binds to what is on its left; 0 when it cannot follow an operand. */
  const infixPower = (token: Token | undefined): number => {
    if (!token) return 0;
    if (token.type === 'op') return token.op === '+' || token.op === '-' ? BP.add : token.op === '^' ? BP.power : token.op === '%' ? BP.postfix : BP.multiply;
    if (token.type !== 'word') return 0;
    if (token.word === 'mod' || token.word === 'of') return BP.multiply;
    if (token.word === 'in') return BP.convert;
    return unitOf(token.word) ? BP.postfix : 0;
  };

  const infix = (token: Token, left: Expr): Expr => {
    if (token.type === 'op') {
      if (token.op === '%') return { type: 'percent', operand: left };
      // ^ is right-associative: its right side may hold another ^.
      const right = expression(token.op === '^' ? BP.power - 1 : infixPower(token));
      return { type: 'binary', op: token.op, left, right };
    }
    const w = (token as Extract<Token, { type: 'word' }>).word;
    if (w === 'mod' || w === 'of') return { type: 'binary', op: w, left, right: expression(BP.multiply) };
    if (w === 'in') {
      const target = next();
      const unit = target.type === 'word' ? unitOf(target.word) : null;
      if (!unit) throw new CalcError('"in" needs a unit');
      return { type: 'convert', operand: left, unit };
    }
    return { type: 'duration', operand: left, unit: unitOf(w)! };
  };

  const expression = (minPower: number): Expr => {
    if (++depth > MAX_DEPTH) throw new CalcError('The expression is nested too deeply');
    let left = prefix(next());
    for (let power = infixPower(peek()); power > minPower; power = infixPower(peek())) left = infix(next(), left);
    depth -= 1;
    return left;
  };

  const tree = expression(0);
  if (at < tokens.length) throw new CalcError('Unexpected text after the expression');
  return tree;
}

/** Whether an expression is only a number, a constant or a name (with a sign): writing it with "=" asks for nothing. */
export function isBare(expr: Expr): boolean {
  if (expr.type === 'negate') return isBare(expr.operand);
  return expr.type === 'number' || expr.type === 'constant' || expr.type === 'variable';
}

/** Whether an expression reads a variable, so its result changes when a variable above it does. */
export function readsVariables(expr: Expr): boolean {
  switch (expr.type) {
    case 'variable':
      return true;
    case 'negate':
    case 'percent':
    case 'duration':
    case 'convert':
      return readsVariables(expr.operand);
    case 'binary':
      return readsVariables(expr.left) || readsVariables(expr.right);
    case 'call':
      return expr.args.some(readsVariables);
    default:
      return false;
  }
}
