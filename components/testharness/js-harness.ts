import type { RunResult } from './types';
import { resultFail, resultOk } from './types';
import { deepEqual } from './deep-equal';

type TestCase = { name: string; fn: () => any | Promise<any> };

function buildHarnessApi(outputLog: string[]) {
  const tests: TestCase[] = [];
  const suiteStack: string[] = [];

  const describe = (name: string, fn: () => void) => {
    suiteStack.push(name);
    try { fn(); } finally { suiteStack.pop(); }
  };

  const test = (name: string, fn: () => any | Promise<any>) => {
    const full = [...suiteStack, name].join(' › ');
    tests.push({ name: full, fn });
  };

  const it = test;

  const expect = (received: any) => ({
    toBe(expected: any) {
      if (!Object.is(received, expected)) {
        throw new Error(`Expected (toBe): ${String(expected)}\nReceived: ${String(received)}`);
      }
    },
    toEqual(expected: any) {
      if (!deepEqual(received, expected)) {
        const ser = (v: any) => {
          try { return JSON.stringify(v, (_k, val) => typeof val === 'bigint' ? `${val}n` : val, 2); }
          catch { return String(v); }
        };
        throw new Error(`Expected (toEqual):\n${ser(expected)}\nReceived:\n${ser(received)}`);
      }
    }
  });

  const orig = console;
  const captured: Console = {
    ...orig,
    log: (...args: any[]) => { outputLog.push(args.map(String).join(' ')); orig.log?.(...args); },
    info: (...args: any[]) => { outputLog.push(args.map(String).join(' ')); orig.info?.(...args); },
    warn: (...args: any[]) => { outputLog.push(args.map(String).join(' ')); orig.warn?.(...args); },
    error: (...args: any[]) => { outputLog.push(args.map(String).join(' ')); orig.error?.(...args); },
    debug: (...args: any[]) => { outputLog.push(args.map(String).join(' ')); orig.debug?.(...args); },
  } as any;

  return { tests, describe, test, it, expect, capturedConsole: captured };
}

function evalCJS(filename: string, source: string, requireFn: (p: string) => any, sandbox: Record<string, any>): any {
  const module = { exports: {} as any };
  const exports = module.exports;
  const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', ...Object.keys(sandbox),
    `${source}\n//# sourceURL=${filename}`);
  fn(requireFn, module, exports, filename, filename.replace(/\/[^/]+$/, ''), ...Object.values(sandbox));
  return module.exports;
}

export async function runJsHarness(solutionSrc: string, testsSrc: string, timeoutMs = 60_000): Promise<RunResult> {
  const logs: string[] = [];
  const { tests, describe, test, it, expect, capturedConsole } = buildHarnessApi(logs);

  let solutionModule: any | null = null;
  const requireOnlySolution = (p: string) => {
    if (p === './solution' || p === './solution.js') return solutionModule ?? {};
    if (p === './tests' || p === './tests.js') throw new Error('Tests cannot be required directly');
    throw new Error(`Unknown require path: ${p}`);
  };

  const sandboxGlobals = {
    console: capturedConsole,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };

  try {
    solutionModule = evalCJS('/js/solution.js', solutionSrc, requireOnlySolution, sandboxGlobals);
    Object.assign(globalThis as any, solutionModule);

    const testRequire = (p: string) => {
      if (p === './solution' || p === './solution.js') return solutionModule;
      throw new Error(`Unknown require path: ${p}`);
    };

    (globalThis as any).describe = describe;
    (globalThis as any).test = test;
    (globalThis as any).it = it;
    (globalThis as any).expect = expect;

    evalCJS('/js/tests.js', testsSrc, testRequire, { console: capturedConsole });

    const results: { name: string; ok: boolean; err?: string }[] = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; }, timeoutMs);

    for (const t of tests) {
      if (timedOut) break;
      try {
        const maybe = t.fn();
        if (maybe && typeof (maybe as any).then === 'function') {
          await Promise.race([
            maybe,
            new Promise((_r, rej) => setTimeout(() => rej(new Error(`Test timeout: ${t.name}`)), timeoutMs)),
          ]);
        }
        results.push({ name: t.name, ok: true });
      } catch (e: any) {
        results.push({ name: t.name, ok: false, err: e?.stack || String(e) });
      }
    }
    clearTimeout(timer);

    if (timedOut) {
      return resultFail(`Run exceeded ${timeoutMs} ms during test execution phase.`, 'timeout', true);
    }

    const failed = results.filter(r => !r.ok);
    const lines: string[] = [];
    lines.push(`Ran ${results.length} tests`);
    for (const r of results) {
      lines.push(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n${r.err}`}`);
    }
    if (logs.length) {
      lines.push('\nConsole output:');
      lines.push(logs.join('\n'));
    }

    if (failed.length === 0) {
      lines.push('OK');
      return resultOk(lines.join('\n') + '\n');
    } else {
      lines.push(`FAILED (failures=${failed.length})`);
      return resultFail(lines.join('\n') + '\n', 'tests_failed');
    }
  } catch (err: any) {
    const name = err?.name || '';
    const isCompile = name.includes('SyntaxError') || /Unknown require path/.test(String(err));
    const tag = isCompile ? 'compile_error' : 'runtime_error';
    const msg = err?.stack || String(err);
    return resultFail(msg, tag as any);
  } finally {
    delete (globalThis as any).describe;
    delete (globalThis as any).test;
    delete (globalThis as any).it;
    delete (globalThis as any).expect;
  }
}
