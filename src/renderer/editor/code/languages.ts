import { MERMAID_LANGUAGE } from '../../../shared/editor/code-languages';
import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/** The language of a code block that draws a Mermaid diagram (D-158). */
export const MERMAID = MERMAID_LANGUAGE;

/**
 * The languages the code block picker offers (D-159): common ones only, so the editor chunk stays small. A block keeps
 * any other language name it was given (an imported note, for example) and shows it unhighlighted.
 */
export const CODE_LANGUAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'plaintext', label: 'Plain text' },
  { id: MERMAID, label: 'Mermaid diagram' },
  { id: 'bash', label: 'Bash' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'css', label: 'CSS' },
  { id: 'diff', label: 'Diff' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'go', label: 'Go' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'ini', label: 'INI / TOML' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'php', label: 'PHP' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'python', label: 'Python' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'shell', label: 'Shell session' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'yaml', label: 'YAML' },
];

const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, plaintext, powershell, python, ruby, rust, shell, sql, swift, typescript, xml, yaml,
});
/** Other names a block's language may have (Markdown fences often use them); the picker shows the language they name. */
const ALIASES: Readonly<Record<string, readonly string[]>> = { plaintext: [MERMAID, 'text', 'txt'], xml: ['html', 'svg'], javascript: ['js', 'jsx'], typescript: ['ts', 'tsx'], python: ['py'], bash: ['sh', 'zsh'], yaml: ['yml'], csharp: ['cs'], cpp: ['c++'], rust: ['rs'], markdown: ['md'] };
lowlight.registerAlias(ALIASES);

/** The picker's language for a stored name: itself, or the language an alias names (`ts` is TypeScript). */
export function canonicalLanguage(language: string | null): string {
  if (!language) return 'plaintext';
  if (language === MERMAID) return MERMAID;
  return Object.entries(ALIASES).find(([, names]) => names.includes(language))?.[0] ?? language;
}

/**
 * The highlighter the code block uses: a block without a known language is plain text, never auto-detected (detection
 * runs every grammar over the text on each change and guesses wrong on short snippets).
 */
export const codeHighlighter = {
  highlight: (language: string, value: string) => lowlight.highlight(language, value),
  highlightAuto: (value: string) => lowlight.highlight('plaintext', value),
  listLanguages: () => lowlight.listLanguages(),
  registered: (name: string) => lowlight.registered(name),
};

/** The picker's label of a language name, or the name itself when it is not one the picker lists. */
export function languageLabel(language: string | null): string {
  if (!language) return 'Plain text';
  const id = canonicalLanguage(language);
  return CODE_LANGUAGES.find((l) => l.id === id)?.label ?? language;
}
