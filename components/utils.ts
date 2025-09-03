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
  const lang = language ?? detectLanguage(code);
  if (lang === 'javascript') return clearJsComments(code);
  return clearPythonWithRegexHeuristics(code);
};

function clearPythonWithRegexHeuristics(input: string): string {
  let src = input.replace(/\r\n?/g, '\n');

  // 1) Strip comments outside strings
  // First alternatives match triple/single strings so '#...' inside them isn't treated as a comment.
  const STRINGS_OR_COMMENT =
    /(?:[rRuUbBfF]{0,3}(?:"""[\s\S]*?"""|'''[\s\S]*?''')|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(#.*?$)/gm;

  src = src.replace(STRINGS_OR_COMMENT, (m, comment) => (comment ? '' : m));

  // Helper for a Python string literal (triple or single; with optional rRbBuUfF prefixes)
  const STRING_LITERAL =
    String.raw`(?:[rRuUbBfF]{0,3}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))`;

  // 2) Remove module docstring at file start (optionally wrapped in parentheses)
  const MODULE_DOC_RE = new RegExp(
    String.raw`^\s*(?:\(\s*)*${STRING_LITERAL}(?:\s*\))*\s*(?=\n|$)`,
    'm'
  );
  src = src.replace(MODULE_DOC_RE, '');

  // 3) Remove first-string statements inside classes/defs (docstrings).
  //    We also handle decorators and blank lines between header and body.
  const HEADER_AND_FIRST_STRING = new RegExp(
    String.raw`^([ \t]*)(?:@[^\n]*\n\1(?:@[^\n]*\n\1)*)?` +        // decorators (same indent), optional
    String.raw`(?:(?:async[ \t]+)?def|class)\b[\s\S]*?:[ \t]*\n` + // header up to ':' and newline
    String.raw`(?:\1[ \t]*\n)*` +                                 // optional blank lines
    String.raw`(?:\1([ \t]+))` +                                  // body indent (must be deeper than header)
    String.raw`(?:\(\s*)*` +                                      // optional parentheses around the docstring
    String.raw`(${STRING_LITERAL})` +                              // the candidate docstring
    String.raw`(?:\s*\))*[ \t]*(?=\n|$)`,                         // closing parens/whitespace, then EOL
    'gm'
  );

  const repls: Array<{ start: number; end: number; text: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = HEADER_AND_FIRST_STRING.exec(src)) !== null) {
    const whole = m[0];
    const headerIndent = m[1] || '';
    const bodyIndent = m[2] || '';
    const stringLit  = m[3] || '';

    // Sanity: docstring line must actually be more indented than the header.
    if (!bodyIndent.startsWith(headerIndent) || bodyIndent.length <= headerIndent.length) continue;

    // Locate the string literal span within the matched chunk
    const local = whole.lastIndexOf(stringLit);
    const start = (m.index || 0) + local;
    const end   = start + stringLit.length;

    // Insert 'pass' only if the block would be empty after removing the docstring.
    const needsPass = !hasContentInBlock(src, end, headerIndent, bodyIndent);
    repls.push({ start, end, text: needsPass ? bodyIndent + 'pass' : '' });
  }

  // Apply replacements from end to start to keep indices stable
  if (repls.length) {
    repls.sort((a, b) => b.start - a.start);
    for (const r of repls) {
      src = src.slice(0, r.start) + r.text + src.slice(r.end);
    }
  }

  // 4) Final tidy (preserve your original behavior)
  return src
    .split('\n')
    .map(l => l.replace(/[ \t]+$/g, '')) // trim trailing whitespace
    .filter(l => l.trim() !== '')        // drop empty lines
    .join('\n');
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
