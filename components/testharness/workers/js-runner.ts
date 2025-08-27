/// <reference lib="webworker" />
import { runJsHarness } from '../js-harness';
import type { RunRequest, RunResult } from '../types';
import { disableNetworkInWorker } from '../sandbox';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (e: MessageEvent<{ kind: 'run'; req: RunRequest }>) => {
  if (e.data?.kind !== 'run') return;
  const { solution, tests, timeoutMs } = e.data.req;

  let payload: RunResult;
  try {
    // JS harness does not need external assets; disable network immediately.
    disableNetworkInWorker();
    payload = await runJsHarness(solution, tests, timeoutMs);
  } catch (err: any) {
    payload = { success: false, output: err?.stack || String(err), error: 'runtime_error', timeout: false };
  }

  (self as any).postMessage({ type: 'result', payload });
};
