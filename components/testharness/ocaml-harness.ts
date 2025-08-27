import type { RunResult } from './types';
import { resultFail, resultOk } from './types';

type OcamlPlatform = {
  FS: {
    mkdirTree: (p: string) => void;
    writeFile: (p: string, data: string | Uint8Array) => void;
    readFile: (p: string, opts?: { encoding?: 'utf8' }) => string | Uint8Array;
  };
  run: (argv: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
};

async function bootOcamlPlatform(assetsBaseURL: string): Promise<OcamlPlatform> {
  const mod = await import(/* webpackIgnore: true */ `${assetsBaseURL}/ocaml/ocaml_platform.mjs`);
  const platform: OcamlPlatform = await (mod as any).createOcamlPlatform({ baseURL: `${assetsBaseURL}/ocaml` });
  return platform;
}

function parseOUnitSummary(text: string): { failures: number; errors: number } | null {
  const m = text.match(/FAILED:\s*(?:[^\n]*\s)?errors:(\d+)\s+failures:(\d+)/i);
  if (m) return { errors: Number(m[1]), failures: Number(m[2]) };
  if (/^\s*OK\s*$/m.test(text)) return { errors: 0, failures: 0 };
  const m2 = text.match(/failures:\s*(\d+)\s*;\s*errors:\s*(\d+)/i);
  if (m2) return { failures: Number(m2[1]), errors: Number(m2[2]) };
  return null;
}

export async function runOcamlWasm(
  solutionSrc: string,
  testsSrc: string,
  assetsBaseURL: string,
  timeoutMs = 60_000
): Promise<RunResult> {
  let ocaml: OcamlPlatform;
  try {
    ocaml = await bootOcamlPlatform(assetsBaseURL);
  } catch (e: any) {
    return resultFail(`Failed to initialize OCaml runtime: ${e?.message || e}`, 'runtime_error');
  }

  try {
    ocaml.FS.mkdirTree('/ml');
    ocaml.FS.writeFile('/ml/Solution.ml', solutionSrc);
    ocaml.FS.writeFile('/ml/test_solution.ml', testsSrc);
  } catch (e: any) {
    return resultFail(`Failed to materialize OCaml files: ${e?.message || e}`, 'runtime_error');
  }

  const runWithTimeout = async (argv: string[]) => {
    const res = await Promise.race([
      ocaml.run(argv),
      new Promise<{ code: number; stdout: string; stderr: string }>((_r, rej) =>
        setTimeout(() => rej(new Error('timeout')), timeoutMs)
      ),
    ]).catch((e: any) => { throw e; });
    return res as { code: number; stdout: string; stderr: string };
  };

  try {
    // Compile Solution.ml
    let r = await runWithTimeout(['ocamlc', '-I', '/ml', '-c', '/ml/Solution.ml']);
    if (r.code !== 0) {
      const diag = (r.stderr || r.stdout || '').trim();
      return resultFail(diag + (diag.endsWith('\n') ? '' : '\n'), 'compile_error');
    }

    // Compile tests
    r = await runWithTimeout(['ocamlc', '-I', '/ml', '-c', '/ml/test_solution.ml']);
    if (r.code !== 0) {
      const diag = (r.stderr || r.stdout || '').trim();
      return resultFail(diag + (diag.endsWith('\n') ? '' : '\n'), 'compile_error');
    }

    // Link
    r = await runWithTimeout([
      'ocamlc', '-I', '/ml',
      '-o', '/ml/a.byte',
      'unix.cma', 'str.cma', 'ounit2.cma', 'Solution.cmo', 'test_solution.cmo'
    ]);
    if (r.code !== 0) {
      const diag = (r.stderr || r.stdout || '').trim();
      return resultFail(diag + (diag.endsWith('\n') ? '' : '\n'), 'compile_error');
    }

    // Run
    r = await runWithTimeout(['ocamlrun', '/ml/a.byte']);
    const rawOut = (r.stdout || '') + (r.stderr || '');
    const parsed = parseOUnitSummary(rawOut);
    if (!parsed) {
      // If ocamlrun returns nonzero but no OUnit summary, treat as runtime error
      if (r.code !== 0) return resultFail(rawOut || 'OCaml runtime error', 'runtime_error');
    }
    const success = parsed ? (parsed.errors === 0 && parsed.failures === 0) : (r.code === 0);
    if (success) return resultOk(rawOut.endsWith('\n') ? rawOut : rawOut + '\n');
    return resultFail(rawOut.endsWith('\n') ? rawOut : rawOut + '\n', 'tests_failed');
  } catch (e: any) {
    if (String(e?.message || e) === 'timeout') {
      return resultFail(`Run exceeded ${timeoutMs} ms during test execution phase.`, 'timeout', true);
    }
    return resultFail(e?.stack || String(e), 'runtime_error');
  }
}
