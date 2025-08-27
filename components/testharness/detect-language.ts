import type { Language, RunRequest, RunResult } from './types';
import { resultFail } from './types';

const CODE_FENCE_RE = /```(\w+)[\s\S]*?```/m;

function tagToLang(tag: string | undefined): Language | null {
  const t = (tag || '').toLowerCase();
  if (t === 'js' || t === 'javascript' || t === 'node' || t === 'nodejs') return 'js';
  if (t === 'py' || t === 'python') return 'python';
  if (t === 'ml' || t === 'ocaml') return 'ocaml';
  return null;
}

function fenceLang(s: string): Language | null {
  const m = s.match(CODE_FENCE_RE);
  return tagToLang(m?.[1]);
}

function headerLang(s: string): Language | null {
  const first = (s.split(/\r?\n/).find((l) => l.trim().length > 0) || '').trim();
  if (/^\/\/\s*LANG:\s*js\b/i.test(first)) return 'js';
  if (/^#\s*LANG:\s*python\b/i.test(first)) return 'python';
  if (/^\(\*\s*LANG:\s*ocaml\s*\*\)/i.test(first)) return 'ocaml';
  return null;
}

function heuristicLang(s: string): Language | null {
  if (/module\.exports\b|require\(/.test(s)) return 'js';
  if (/from\s+typing\s+import\b|def\s+solve\s*\(/.test(s)) return 'python';
  if (/let\s+solve\s*\(|open\s+OUnit2\b/.test(s)) return 'ocaml';
  return null;
}

export function detectLanguageRaw(solution: string, tests: string): Language | null {
  const sol1 = fenceLang(solution);
  const tst1 = fenceLang(tests);
  const sol2 = sol1 ?? headerLang(solution);
  const tst2 = tst1 ?? headerLang(tests);
  const sol3 = sol2 ?? heuristicLang(solution);
  const tst3 = tst2 ?? heuristicLang(tests);
  if (tst3) return tst3;      // tests win
  if (sol3) return sol3;
  return null;
}

export function detectLanguageOrError(solution: string, tests: string): Language | RunResult {
  const lang = detectLanguageRaw(solution, tests);
  if (!lang) return resultFail('Language detection failed', 'bad_language_detection');
  return lang;
}

export function detectLanguage(req: Pick<RunRequest, 'solution' | 'tests' | 'language'>): Language | RunResult {
  if (req.language) return req.language;
  return detectLanguageOrError(req.solution, req.tests);
}
