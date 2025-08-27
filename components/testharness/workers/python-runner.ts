/// <reference lib="webworker" />
import { runPythonPyodide } from '../python-harness';
import type { RunRequest, RunResult } from '../types';
import { disableNetworkInWorker } from '../sandbox';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<{ kind: 'run'; req: RunRequest; assetsBase?: string }>) => {
  if (e.data?.kind !== 'run') return;
  const { solution, tests, timeoutMs } = e.data.req;
  const assetsBase = e.data.assetsBase || `${(self as any).location?.origin || ''}/runtimes`;

  let payload: RunResult;
  try {
    // Allow bootstrapping Pyodide via network, then disable network for user code.
    payload = await runPythonPyodide(solution, tests, assetsBase, timeoutMs);
    disableNetworkInWorker();
  } catch (err: any) {
    payload = { success: false, output: err?.stack || String(err), error: 'runtime_error', timeout: false };
  }

  (self as any).postMessage({ type: 'result', payload });
};
