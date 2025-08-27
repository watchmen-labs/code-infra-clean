import type { RunResult } from './types';
import { resultFail, resultOk } from './types';

async function bootPyodide(assetsBaseURL: string): Promise<any> {
  const mod = await import(/* webpackIgnore: true */ `${assetsBaseURL}/pyodide/pyodide.mjs`);
  const pyodide = await (mod as any).loadPyodide({ indexURL: `${assetsBaseURL}/pyodide` });
  return pyodide;
}

const PY_HARNESS = `
import io, sys, unittest, importlib, json, traceback
sys.path.insert(0, "/py")
importlib.invalidate_caches()

buf = io.StringIO()
text = ""
try:
    import solution
except Exception:
    text = buf.getvalue()
    print("IMPORT_ERROR_START")
    traceback.print_exc()
    print("IMPORT_ERROR_END")
    raise

loader = unittest.TestLoader()
suite = loader.discover("/py", pattern="test_*.py")
res = unittest.TextTestRunner(stream=buf, verbosity=2).run(suite)
text = buf.getvalue()
out = {"testsRun": res.testsRun, "failures": len(res.failures), "errors": len(res.errors), "text": text}
print("REPORT_JSON_START")
print(json.dumps(out))
print("REPORT_JSON_END")
`;

export async function runPythonPyodide(
  solutionSrc: string,
  testsSrc: string,
  assetsBaseURL: string,
  timeoutMs = 60_000
): Promise<RunResult> {
  let py: any;
  try {
    py = await bootPyodide(assetsBaseURL);
  } catch (e: any) {
    return resultFail(`Failed to initialize Python runtime: ${e?.message || e}`, 'runtime_error');
  }

  try {
    // @ts-ignore
    py.FS.mkdirTree('/py');
    // @ts-ignore
    py.FS.writeFile('/py/solution.py', solutionSrc);
    // @ts-ignore
    py.FS.writeFile('/py/test_solution.py', testsSrc);
  } catch (e: any) {
    return resultFail(`Failed to materialize files: ${e?.message || e}`, 'runtime_error');
  }

  let out = '', err = '';
  py.setStdout({ batched: (s: string) => { out += s; } });
  py.setStderr({ batched: (s: string) => { err += s; } });

  let didTimeout = false;
  const timer = setTimeout(() => { didTimeout = true; }, timeoutMs);
  try {
    const exec = py.runPythonAsync(PY_HARNESS);
    await Promise.race([
      exec,
      new Promise((_r, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.message === 'timeout') {
      return resultFail(`Run exceeded ${timeoutMs} ms during test execution phase.`, 'timeout', true);
    }
    if (/IMPORT_ERROR_START/.test(out) || /SyntaxError/.test(err)) {
      return resultFail((err || out) || String(e), 'compile_error');
    }
    return resultFail((err || out) || (e?.stack || String(e)), 'runtime_error');
  }
  clearTimeout(timer);
  if (didTimeout) {
    return resultFail(`Run exceeded ${timeoutMs} ms during test execution phase.`, 'timeout', true);
  }

  const m = out.match(/REPORT_JSON_START\s*([\s\S]*?)\s*REPORT_JSON_END/);
  if (!m) {
    const txt = out || err || '';
    if (/FAILED|Failure|AssertionError/.test(txt)) {
      return resultFail(txt, 'tests_failed');
    }
    return resultFail(txt || 'Unknown failure (no report parsed)', 'runtime_error');
  }
  try {
    const report = JSON.parse(m[1]);
    const text: string = report.text ?? '';
    const failures = Number(report.failures || 0);
    const errors = Number(report.errors || 0);
    const success = failures === 0 && errors === 0;
    if (success) return resultOk(text.endsWith('\n') ? text : text + '\n');
    return resultFail(text.endsWith('\n') ? text : text + '\n', 'tests_failed');
  } catch (e: any) {
    return resultFail(`Failed to parse report: ${e?.message || e}\n${out}`, 'runtime_error');
  }
}
