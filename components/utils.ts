import { DatasetItem, Analytics } from './types'
type SupportedLanguage = 'python' | 'javascript'

export const detectLanguage = (code: string): SupportedLanguage => {
  // If there's any "def ... :" anywhere, assume Python; otherwise JavaScript.
  return /(^|[\r\n])\s*def\b[^:\n]*:/m.test(code) ? 'python' : 'javascript';
};

export const clearJsComments = (code: string): string => {
  let result = '';
  let i = 0;
  let inSingle = false, inDouble = false, inTemplate = false, inRegex = false;
  let lastChar = '', currChar = '', nextChar = '';
  let inBlockComment = false, inLineComment = false;
  while (i < code.length) {
    currChar = code[i];
    nextChar = code[i + 1];
    if (inBlockComment) {
      if (currChar === '*' && nextChar === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inLineComment) {
      if (currChar === '\n') {
        inLineComment = false;
        result += currChar;
      }
      i++;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && !inRegex) {
      if (currChar === '/' && nextChar === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (currChar === '/' && nextChar === '/') {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (currChar === '"') {
        inDouble = true;
        result += currChar;
        i++;
        continue;
      }
      if (currChar === "'") {
        inSingle = true;
        result += currChar;
        i++;
        continue;
      }
      if (currChar === '`') {
        inTemplate = true;
        result += currChar;
        i++;
        while (i < code.length) {
          currChar = code[i];
          result += currChar;
          if (currChar === '`') {
            let backslashCount = 0;
            let j = i - 1;
            while (j >= 0 && code[j] === '\\') {
              backslashCount++;
              j--;
            }
            if (backslashCount % 2 === 0) {
              inTemplate = false;
              i++;
              break;
            }
          }
          i++;
        }
        continue;
      }
      if (currChar === '/' && (
        /[=(:,[!&|?{};\n]/.test(lastChar) || result === ''
      )) {
        inRegex = true;
        result += currChar;
        i++;
        continue;
      }
    } else {
      if (inDouble) {
        result += currChar;
        if (currChar === '"' && lastChar !== '\\') inDouble = false;
        i++;
        continue;
      }
      if (inSingle) {
        result += currChar;
        if (currChar === "'" && lastChar !== '\\') inSingle = false;
        i++;
        continue;
      }
      if (inTemplate) {
        i++;
        continue;
      }
      if (inRegex) {
        result += currChar;
        if (currChar === '/' && lastChar !== '\\') {
          let j = i + 1;
          while (/[gimsuy]/.test(code[j])) {
            result += code[j];
            j++;
          }
          i = j;
          inRegex = false;
          continue;
        }
        i++;
        continue;
      }
    }
    result += currChar;
    lastChar = currChar;
    i++;
  }
  let lines = result.split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .filter(line => line.trim() !== '');
  return lines.join('\n');
};

// Assumes you already have: detectLanguage(...) and clearJsComments(...)

export const clearCommentsAndDocstrings = (code: string, language?: SupportedLanguage): string => {
  if (!code || code.trim().length === 0) return code;
  let cleaned = clearPythonWithRegexHeuristics(code, {
    preserveWhitespace: false, // let it trim trailing spaces
    // keep other defaults (docstrings removed, shebang/encoding preserved, etc.)
  });


  // Final normalization for BOTH languages:
  // - remove trailing spaces
  // - drop completely empty lines
  cleaned = cleaned
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t\f]+$/g, ''))
    .filter(line => line.trim() !== '')
    .join('\n');

  return cleaned;
};
// clearPython.ts
export interface ClearPythonOptions {
  /** Remove docstrings for module/class/function. Default: true */
  removeDocstrings?: boolean;
  /** Keep the first-line shebang (#! ...). Default: true */
  preserveShebang?: boolean;
  /** Keep PEP 263 encoding cookie in line 1 or 2. Default: true */
  preserveEncodingCookie?: boolean;
  /** If the docstring is the only statement in a suite, insert `pass`. Default: true */
  insertPassForEmptyBlocks?: boolean;
  /** Keep original blank lines / trailing spaces. Default: true */
  preserveWhitespace?: boolean;
}

const DEFAULTS: Required<ClearPythonOptions> = {
  removeDocstrings: true,
  preserveShebang: true,
  preserveEncodingCookie: true,
  insertPassForEmptyBlocks: true,
  preserveWhitespace: true,
};

export function clearPythonWithRegexHeuristics(
  input: string,
  options: ClearPythonOptions = {}
): string {
  const opt = { ...DEFAULTS, ...options };
  const src = input;
  const n = src.length;

  type Span = { start: number; end: number; text?: string };
  const repls: Span[] = [];

  // ---- small helpers -------------------------------------------------------
  const isQuote = (c: string) => c === `"` || c === `'`;
  const isPrefixChar = (c: string) =>
    c === "r" || c === "R" || c === "f" || c === "F" || c === "b" || c === "B" || c === "u" || c === "U";

  const lineStarts: number[] = [0];
  for (let i = 0; i < n; i++) if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= pos) {
        if (mid + 1 >= lineStarts.length || lineStarts[mid + 1] > pos) return mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return 0;
  };
  const lineStartOf = (pos: number) => lineStarts[lineOf(pos)];
  const lineEndOf = (pos: number) => {
    const li = lineOf(pos);
    return li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : n;
  };
  const startsWithAt = (i: number, s: string) => src.substr(i, s.length) === s;
  const encodingCookieRe = /^\s*#.*coding[:=]\s*([-\w.]+)/;

  // ---- string & f-string scanners -----------------------------------------
  function tryScanString(i: number): { end: number } | null {
    let j = i;
    while (j < n && isPrefixChar(src[j])) j++;
    if (j >= n || !isQuote(src[j])) {
      if (!isQuote(src[i])) return null;
      j = i;
    }
    const quote = src[j];
    const triple = j + 2 < n && src[j + 1] === quote && src[j + 2] === quote;
    const prefix = src.substring(i, j);
    const isF = /[fF]/.test(prefix);
    const isRaw = /[rR]/.test(prefix);
    const end = isF ? scanFString(j, quote, triple, isRaw) : scanPlainString(j, quote, triple, isRaw);
    return { end };
  }

  function scanPlainString(posAtQuote: number, quote: string, triple: boolean, isRaw: boolean): number {
    let i = posAtQuote + (triple ? 3 : 1);
    while (i < n) {
      const c = src[i];
      if (!isRaw && c === "\\") { i += 2; continue; }
      if (triple) {
        if (c === quote && i + 2 < n && src[i + 1] === quote && src[i + 2] === quote) return i + 3;
        i++;
      } else {
        if (c === "\n" || c === "\r") return i;
        if (c === quote) return i + 1;
        i++;
      }
    }
    return n;
  }

  function scanFString(posAtQuote: number, quote: string, triple: boolean, isRaw: boolean): number {
    let i = posAtQuote + (triple ? 3 : 1);
    while (i < n) {
      const c = src[i];
      if (!isRaw && c === "\\") { i += 2; continue; }
      if (c === "{") {
        if (i + 1 < n && src[i + 1] === "{") { i += 2; continue; }
        i = scanFExpression(i + 1);
        continue;
      }
      if (c === "}") {
        if (i + 1 < n && src[i + 1] === "}") { i += 2; continue; }
        i++; continue;
      }
      if (triple) {
        if (c === quote && i + 2 < n && src[i + 1] === quote && src[i + 2] === quote) return i + 3;
        i++;
      } else {
        if (c === "\n" || c === "\r") return i;
        if (c === quote) return i + 1;
        i++;
      }
    }
    return n;
  }

  function scanFExpression(i: number): number {
    let depthBrace = 1, depthParen = 0, depthBracket = 0;
    while (i < n) {
      const c = src[i];
      if (isQuote(c) || (isPrefixChar(c) && i + 1 < n && isQuote(src[i + 1]))) {
        const s = tryScanString(i)!;
        i = s.end; continue;
      }
      if (c === "#") { i = lineEndOf(i); continue; }
      if (c === "\\") {
        const nxt = src[i + 1]; if (nxt === "\n" || nxt === "\r") { i += 2; continue; }
      }
      if (c === "(") { depthParen++; i++; continue; }
      if (c === ")") { depthParen = Math.max(0, depthParen - 1); i++; continue; }
      if (c === "[") { depthBracket++; i++; continue; }
      if (c === "]") { depthBracket = Math.max(0, depthBracket - 1); i++; continue; }
      if (c === "{") { depthBrace++; i++; continue; }
      if (c === "}") { depthBrace--; i++; if (depthBrace === 0) return i; continue; }
      i++;
    }
    return n;
  }

  // ---- pass 1: strip comments (preserve shebang/encoding if configured) ---
  {
    let i = 0, lineNo = 0;
    while (i < n) {
      const ls = i;
      let le = lineEndOf(ls);
      const isShebang = lineNo === 0 && startsWithAt(ls, "#!");
      const maybeEnc = (lineNo === 0 || lineNo === 1) && encodingCookieRe.test(src.slice(ls, le));

      let j = ls;
      while (j < le) {
        const s = tryScanString(j);
        if (s) { j = s.end; continue; }
        if (src[j] === "#") {
          if ((opt.preserveShebang && isShebang) || (opt.preserveEncodingCookie && maybeEnc)) {
            j = le; break;
          }
          repls.push({ start: j, end: le }); j = le; break;
        }
        j++;
      }
      lineNo++; i = le + 1;
    }
  }

  // ---- pass 2: remove true docstrings (module/def/class) -------------------
  if (opt.removeDocstrings) {
    type Block = { indent: string; kind: "module" | "class" | "def" | "other"; firstPending: boolean };
    const stack: Block[] = [{ indent: "", kind: "module", firstPending: true }];

    const getIndentAt = (ls: number) => {
      let i = ls, out = "";
      const le = lineEndOf(ls);
      while (i < le && (src[i] === " " || src[i] === "\t" || src[i] === "\f")) { out += src[i++]; }
      return out;
    };

    const startsWithWord = (i: number, word: string) => {
      if (!startsWithAt(i, word)) return false;
      const before = i - 1 >= 0 ? src[i - 1] : "";
      const after = i + word.length < n ? src[i + word.length] : "";
      const isId = (ch: string) => /[A-Za-z0-9_]/.test(ch);
      return !isId(before) && !isId(after);
    };

    const analyzeSimpleStatement = (a: number, b: number, ctx: Block) => {
      // Optional "async"
      let i = a; while (i < b && /\s/.test(src[i])) i++;
      let sawAsync = false;
      if (startsWithWord(i, "async")) { i += 5; while (i < b && /\s/.test(src[i])) i++; sawAsync = true; }

      const isDef = startsWithWord(i, "def");
      const isClass = startsWithWord(i, "class");
      if ((isDef || isClass) && (sawAsync ? isDef : (isDef || isClass))) {
        // Find the colon of the header at depth 0
        let j = i, depth = 0, colonAt = -1;
        while (j < b) {
          const s = tryScanString(j);
          if (s) { j = s.end; continue; }
          const c = src[j];
          if (c === "(" || c === "[" || c === "{") { depth++; j++; continue; }
          if (c === ")" || c === "]" || c === "}") { depth = Math.max(0, depth - 1); j++; continue; }
          if (c === ":" && depth === 0) { colonAt = j; break; }
          if (c === "#") { j = b; break; } // comment tail
          j++;
        }
        if (colonAt !== -1) {
          const headerIndent = getIndentAt(lineStartOf(a));
          // Determine if there are inline small statements after ':'
          let k = colonAt + 1; while (k < b && (src[k] === " " || src[k] === "\t")) k++;
          const sameLineSuite = k < b;
          // Push block expecting first stmt
          stack.push({ indent: headerIndent, kind: isDef ? "def" : "class", firstPending: true });

          if (sameLineSuite) {
            // The rest of [k,b) are small statements separated by ';'
            let segStart = k;
            while (segStart < b) {
              let segEnd = segStart, depth2 = 0;
              while (segEnd < b) {
                const t = tryScanString(segEnd);
                if (t) { segEnd = t.end; continue; }
                const ch = src[segEnd];
                if (ch === "(" || ch === "[" || ch === "{") { depth2++; segEnd++; continue; }
                if (ch === ")" || ch === "]" || ch === "}") { depth2 = Math.max(0, depth2 - 1); segEnd++; continue; }
                if (depth2 === 0 && ch === ";") break;
                segEnd++;
              }
              maybeRemoveDocstring(segStart, segEnd, stack[stack.length - 1], /*isSameLine*/true);
              if (segEnd < b && src[segEnd] === ";") segEnd++;
              while (segEnd < b && (src[segEnd] === " " || src[segEnd] === "\t")) segEnd++;
              segStart = segEnd;
            }
            stack.pop();
          }
          return;
        }
      }

      // Ordinary simple statement
      maybeRemoveDocstring(a, b, ctx, false);
    };

    const maybeRemoveDocstring = (a: number, b: number, ctx: Block, sameLineSuite: boolean) => {
      if (!(ctx.kind === "module" || ctx.kind === "def" || ctx.kind === "class")) return;
      if (!ctx.firstPending) return;

      let i = a; while (i < b && /\s/.test(src[i])) i++;
      let j = b; while (j > i && /\s/.test(src[j - 1])) j--;
      if (i >= j) return;

      // Peel parens that enclose the whole thing
      const matchClosing = (openPos: number, endLimit: number) => {
        const open = src[openPos], want = open === "(" ? ")" : open === "[" ? "]" : "}";
        let p = openPos + 1, depth = 1;
        while (p < endLimit) {
          const s = tryScanString(p); if (s) { p = s.end; continue; }
          const ch = src[p];
          if (ch === open) { depth++; p++; continue; }
          if (ch === want) { depth--; p++; if (depth === 0) return p; continue; }
          if (ch === "#") { p = lineEndOf(p); continue; }
          p++;
        }
        return -1;
      };

      let ii = i, jj = j, changed = true;
      while (changed) {
        changed = false;
        if (src[ii] === "(" || src[ii] === "[" || src[ii] === "{") {
          const close = matchClosing(ii, jj);
          if (close === jj) { ii++; jj--; changed = true; }
        }
        while (ii < jj && /\s/.test(src[ii])) ii++;
        while (jj > ii && /\s/.test(src[jj - 1])) jj--;
      }

      // Must be one or more adjacent string literals, nothing else
      let p = ii, sawString = false;
      while (p < jj) {
        while (p < jj && /\s/.test(src[p])) p++;
        const s = tryScanString(p);
        if (!s) { sawString = false; break; }
        sawString = true;
        p = s.end;
        while (p < jj && /\s/.test(src[p])) p++;
      }
      if (!(sawString && p === jj)) { ctx.firstPending = false; return; }

      // Docstring detected
      const stmtIndent = src.substring(lineStartOf(a), ii).replace(/[^\t \f]/g, "");
      if (sameLineSuite) {
        const needPass = opt.insertPassForEmptyBlocks;
        repls.push({ start: ii, end: jj, text: needPass ? "pass" : "" });
        ctx.firstPending = false; return;
      } else {
        const needPass = opt.insertPassForEmptyBlocks && !hasContentInBlockAfterDocstring(jj, ctx.indent);
        repls.push({ start: ii, end: jj, text: needPass ? stmtIndent + "pass" : "" });
        ctx.firstPending = false; return;
      }
    }

    const hasContentInBlockAfterDocstring = (pos: number, headerIndent: string): boolean => {
      let i = pos;
      while (i < n) {
        const ls = lineStartOf(i);
        let le = lineEndOf(ls);
        const indent = (() => {
          let k = ls, out = "";
          while (k < le && (src[k] === " " || src[k] === "\t" || src[k] === "\f")) out += src[k++];
          return out;
        })();
        // End of block?
        if (!(indent.startsWith(headerIndent) && indent.length > headerIndent.length)) {
          // Dedented to header or less → no more content in this block
          return false;
        }
        // Skip blank lines and pure comment lines
        let k = ls + indent.length;
        while (k < le && /\s/.test(src[k])) k++;
        if (k >= le) { i = le + 1; continue; }
        if (src[k] === "#") { i = le + 1; continue; }
        // Anything else counts as content (even another string)
        return true;
      }
      return false;
    }

    // Walk file by physical lines; split into simple statements by ';' at depth 0
    {
      let i = 0;
      while (i < n) {
        const ls = lineStartOf(i);
        let le = lineEndOf(ls);
        const indent = (() => {
          let k = ls, out = "";
          while (k < le && (src[k] === " " || src[k] === "\t" || src[k] === "\f")) out += src[k++];
          return out;
        })();
        // Dedent stack according to physical indent
        while (stack.length > 1 && stack[stack.length - 1].indent.length > indent.length) stack.pop();

        let j = ls + indent.length, depth = 0, stmtStart = j;
        while (j <= le) {
          if (j === le || (src[j] === ";" && depth === 0)) {
            const stmtEnd = j;
            if (stmtEnd > stmtStart) analyzeSimpleStatement(stmtStart, stmtEnd, stack[stack.length - 1]);
            if (j === le) break;
            j++; while (j < le && (src[j] === " " || src[j] === "\t")) j++;
            stmtStart = j; continue;
          }
          const s = tryScanString(j);
          if (s) {
            // If the string literal spans beyond the current physical line,
            // extend `le` so this whole logical statement is analyzed as one unit.
            if (s.end > le) {
              const pos = Math.min(n - 1, s.end - 1);
              le = lineEndOf(pos);
            }
            j = s.end;
            continue;
          }
          const c = src[j];
          if (c === "(" || c === "[" || c === "{") { depth++; j++; continue; }
          if (c === ")" || c === "]" || c === "}") { depth = Math.max(0, depth - 1); j++; continue; }
          if (c === "#") { j = le; continue; }
          j++;
        }
        i = le + 1;
      }
    }
  }

  // ---- apply replacements --------------------------------------------------
  if (repls.length) {
    repls.sort((a, b) => b.start - a.start);
    let out = src;
    for (const r of repls) out = out.slice(0, r.start) + (r.text ?? "") + out.slice(r.end);
    if (!opt.preserveWhitespace) {
      out = out
        .split(/\r?\n/)
        .map(l => l.replace(/[ \t\f]+$/g, ""))
        .join(out.includes("\r\n") ? "\r\n" : "\n");
    }
    return out;
  }
  return src;
}


/**
 * After a docstring at `pos`, check for the next non-blank line:
 * - If it dedents to headerIndent (or less), the block is empty.
 * - If it has indent >= bodyIndent and non-blank content, there is code.
 * Assumes comments have been removed already.
 */
function hasContentInBlock(src: string, pos: number, headerIndent: string, bodyIndent: string): boolean {
  const n = src.length;
  let i = pos;

  // Move to start of next line
  if (i < n && src[i] === '\r') i++;
  if (i < n && src[i] === '\n') i++;

  while (i < n) {
    let j = src.indexOf('\n', i);
    if (j === -1) j = n;

    const line = src.slice(i, j);
    const indentMatch = line.match(/^[ \t]*/)!;
    const indent = indentMatch[0];
    const content = line.slice(indent.length);

    // Block ended (dedent to header or left of it)
    if (indent.length <= headerIndent.length && !indent.startsWith(bodyIndent)) {
      return false;
    }
    // Non-blank line inside the block
    if (indent.startsWith(bodyIndent) && content.trim() !== '') {
      return true;
    }

    i = j + 1;
  }
  return false;
}


export const calculateAnalytics = (data: DatasetItem[]): Analytics => {
  const list: DatasetItem[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.items)
      ? (data as any).items
      : Array.isArray((data as any)?.data)
        ? (data as any).data
        : [];

  const analytics: Analytics = {
    totalItems: list.length,
    byDifficulty: {},
    byTopic: {},
    successfulRuns: list.filter(item => item.lastRunSuccessful).length,
    itemsWithNotes: list.filter(item => item.notes && item.notes.trim()).length
  };

  list.forEach(item => {
    analytics.byDifficulty[item.difficulty] = (analytics.byDifficulty[item.difficulty] || 0) + 1;
    item.topics.forEach(topic => {
      analytics.byTopic[topic] = (analytics.byTopic[topic] || 0) + 1;
    });
  });

  return analytics;
};

export const executeExport = (
  items: DatasetItem[],
  selectedIds: Set<string>,
  exportOptions: { format: 'json' | 'csv' | 'jsonl'; keys: Set<keyof DatasetItem> }
) => {
  const itemsToExport = selectedIds.size > 0 ? items.filter(item => selectedIds.has(item.id)) : items;
  const { format } = exportOptions;

  const fileExtension = format;
  const exportFileDefaultName = `competitive-programming-dataset-${new Date().toISOString().split('T')[0]}.${fileExtension}`;
  let dataStr: string;
  let dataUri: string;

  if (format === 'csv') {
    const csvHeaders = [
      'id', 'language', 'prompt', 'inputs', 'outputs', 'code_file', 'reference_solution', 'sota_solution', 'unit_tests',
      'difficulty', 'topics', 'time_complexity', 'space_complexity', 'sota_time_complexity', 'sota_space_complexity', 'sota_correct', 'notes',
      'createdAt', 'updatedAt', 'lastRunSuccessful', 'group', 'full_task_json'
    ];
    const header = csvHeaders.join(',') + '\n';
    const rows = itemsToExport.map(item => {
      const fullTaskJson = JSON.stringify({
        id: item.id,
        language: item.language || 'python',
        prompt: item.prompt,
        inputs: item.inputs,
        outputs: item.outputs,
        code_file: item.code_file,
        reference_solution: item.solution,
        sota_solution: item.sota_solution,
        unit_tests: item.unit_tests,
        metadata: {
          difficulty: item.difficulty,
          topics: item.topics,
          time_complexity: item.time_complexity,
          space_complexity: item.space_complexity,
          sota_time_complexity: item.sota_time_complexity,
          sota_space_complexity: item.sota_space_complexity,
          sota_correct: item.sota_correct,
        }
      });

      const rowValues = [
        item.id,
        item.language,
        item.prompt,
        item.inputs,
        item.outputs,
        item.code_file,
        item.solution,
        item.sota_solution,
        item.unit_tests,
        item.difficulty,
        item.topics,
        item.time_complexity,
        item.space_complexity,
        item.sota_time_complexity,
        item.sota_space_complexity,
        item.sota_correct,
        item.notes,
        item.createdAt,
        item.updatedAt,
        item.lastRunSuccessful,
        item.group,
        fullTaskJson
      ];

      return rowValues.map(value => {
        if (Array.isArray(value)) value = value.join(';');
        const stringValue = String(value ?? '');
        return `"${stringValue.replace(/"/g, '""')}"`;
      }).join(',');
    }).join('\n');
    dataStr = header + rows;
    dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(dataStr);
  } else if (format === 'jsonl') {
    const transformedData = itemsToExport.map(item => ({
      id: item.id,
      language: item.language || 'python',
      prompt: item.prompt,
      inputs: item.inputs,
      outputs: item.outputs,
      code_file: item.code_file,
      reference_solution: item.solution,
      sota_solution: item.sota_solution,
      unit_tests: item.unit_tests,
      metadata: {
        difficulty: item.difficulty,
        topics: item.topics,
        time_complexity: item.time_complexity,
        space_complexity: item.space_complexity,
        sota_time_complexity: item.sota_time_complexity,
        sota_space_complexity: item.sota_space_complexity,
        sota_correct: item.sota_correct,
      }
    }));
    dataStr = transformedData.map(item => JSON.stringify(item)).join('\n');
    dataUri = 'data:application/jsonl;charset=utf-8,' + encodeURIComponent(dataStr);
  } else {
    const transformedData = itemsToExport.map(item => ({
      id: item.id,
      language: item.language || 'python',
      prompt: item.prompt,
      inputs: item.inputs,
      outputs: item.outputs,
      code_file: item.code_file,
      reference_solution: item.solution,
      sota_solution: item.sota_solution,
      unit_tests: item.unit_tests,
      metadata: {
        difficulty: item.difficulty,
        topics: item.topics,
        time_complexity: item.time_complexity,
        space_complexity: item.space_complexity,
        sota_time_complexity: item.sota_time_complexity,
        sota_space_complexity: item.sota_space_complexity,
        sota_correct: item.sota_correct,
      }
    }));
    dataStr = JSON.stringify(transformedData, null, 2);
    dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  }
  
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
}



// components/VersionLabelUtils.ts
export const splitByCommaOrSemicolon = (s: string) =>
  s.split(/[,;]+/).map(x => x.trim()).filter(Boolean);

export const parseStandardLabel = (label?: string | null) => {
  const raw = (label || "").trim();
  if (!raw) return { editor: "", stamps: [] as string[] };
  const idx = raw.indexOf(":");
  if (idx === -1) return { editor: raw, stamps: [] };
  const editor = raw.slice(0, idx).trim();
  const rest = raw.slice(idx + 1).trim();
  const stamps = rest ? Array.from(new Set(splitByCommaOrSemicolon(rest))) : [];
  return { editor, stamps };
};

export const formatStandardLabel = (editor: string, stamps: string[]) => {
  const uniq = Array.from(new Set(stamps.filter(Boolean)));
  const base = editor || "";
  if (uniq.length === 0) return base ? `${base}:` : "";
  return `${base}: ${uniq.join(", ")}`;
};

export const mergeStampIntoLabel = (label: string | null | undefined, stamper: string) => {
  const { editor, stamps } = parseStandardLabel(label);
  const nextEditor = editor || "";
  return formatStandardLabel(nextEditor, [...stamps, stamper]);
};


// components/CacheUtils.ts
export const readCache = (key: string, ttlMs = 60_000) => {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j || !j.ts || !("data" in j)) return null;
    if (Date.now() - j.ts > ttlMs) {
      sessionStorage.removeItem(key);
      return null;
    }
    return j.data;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
};

export const writeCache = (key: string, data: any) => {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
};

export const updateArrayItemInCacheById = (key: string, updated: { id: string } & Record<string, any>) => {
  const cached = readCache(key);
  if (!cached || !Array.isArray(cached)) return;
  const idx = cached.findIndex((x: any) => x.id === updated.id);
  if (idx >= 0) {
    const next = [...cached];
    next[idx] = { ...next[idx], ...updated };
    writeCache(key, next);
  }
};
