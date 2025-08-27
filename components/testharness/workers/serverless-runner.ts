// Node worker thread entry (for Vercel serverless). Dispatches to the same harnesses.
import { parentPort } from 'node:worker_threads';
import type { RunRequest, RunResult } from '@/components/testharness/types';
import { detectLanguage } from '@/components/testharness/detect-language';
import { runJsHarness } from '@/components/testharness/js-harness';
import { runPythonPyodide } from '@/components/testharness/python-harness';
import { runOcamlWasm } from '@/components/testharness/ocaml-harness';
import { serverlessAssetsBaseURL } from '@/components/testharness/node-asset-paths';

const ASSETS_BASE = serverlessAssetsBaseURL();

parentPort?.on('message', async (m: { kind: 'run'; req: RunRequest }) => {
  if (m?.kind !== 'run') return;
  const req = m.req;
  const langOrErr = detectLanguage(req);
  let payload: RunResult;

  try {
    if (typeof langOrErr !== 'string') {
      payload = langOrErr;
    } else if (langOrErr === 'js') {
      payload = await runJsHarness(req.solution, req.tests, req.timeoutMs);
    } else if (langOrErr === 'python') {
      payload = await runPythonPyodide(req.solution, req.tests, ASSETS_BASE, req.timeoutMs);
    } else { // ocaml
      payload = await runOcamlWasm(req.solution, req.tests, ASSETS_BASE, req.timeoutMs);
    }
  } catch (err: any) {
    payload = { success: false, output: err?.stack || String(err), error: 'runtime_error', timeout: false };
  }

  parentPort?.postMessage({ type: 'result', payload });
});
