import { DatasetItem, Analytics } from './types'
type SupportedLanguage = 'python' | 'javascript'

export const detectLanguage = (code: string): SupportedLanguage => {
  const pySignals = /(^|\n)\s*(def |class |from |import )|("""|''')|(^|\n)\s*#/.test(code)
  const jsSignals = /(\/\*|\*\/|\/\/)|(^|\n)\s*(const |let |var |function )|=>|`/.test(code)
  if (pySignals && !jsSignals) return 'python'
  if (jsSignals && !pySignals) return 'javascript'
  if (/\/\/|\/\*/.test(code)) return 'javascript'
  if (/#|("""|''')/.test(code)) return 'python'
  return 'javascript'
}

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

export const clearCommentsAndDocstrings = (code: string, language?: SupportedLanguage): string => {
  const lang = language ?? detectLanguage(code);
  if (lang === 'javascript') {
    return clearJsComments(code);
  }
  const pythonRegex = /(^\s*(?:"""[\s\S]*?"""|'''[\s\S]*?'''))|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(#.*$)|("""[\s\S]*?"""|'''[\s\S]*?''')/gm;
  let cleaned = code.replace(pythonRegex, (match, docstring, regularString, comment) => {
    if (docstring || comment) {
      return '';
    }
    return match;
  });
  let lines = cleaned.split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .filter(line => line.trim() !== '');
  return lines.join('\n');
};

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
