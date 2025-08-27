import type { RunRequest, RunResult, Language } from './types';
import { DEFAULT_TIMEOUT_MS, resultFail } from './types';
import { detectLanguage } from './detect-language';

// ---------- Browser entry ----------
/**
 * Browser entry (client-only). Spawns a dedicated Web Worker per run.
 * The worker asset is served from `/runtimes/{lang}-runner.js`.
 */
export async function runAutograder(req: RunRequest): Promise<RunResult> {
  const langOrErr = detectLanguage(req);
  if (typeof langOrErr !== 'string') return langOrErr;
  const lang: Language = langOrErr;

  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const workerUrl = `/runtimes/${lang}-runner.js`;
  const worker = new Worker(workerUrl, { type: 'module' });

  return await new Promise<RunResult>((resolve) => {
    const timer = setTimeout(() => {
      try { worker.terminate(); } catch { /* ignore */ }
      resolve({ success: false, output: "Timed out", error: "timeout", timeout: true });
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === 'result') {
        clearTimeout(timer);
        try { worker.terminate(); } catch {}
        resolve(d.payload as RunResult);
      } else if (d?.type === 'stderr') {
        // streaming hook (optional)
      }
    };

    worker.postMessage({ kind: 'run', req: { ...req, language: lang, timeoutMs } });
  });
}

// ---------- Serverless entry ----------
/**
 * Serverless entry (Vercel/Next). Spawns a Node worker thread that runs the
 * same language harnesses (Pyodide/OCaml wasm instantiated via Node).
 */
export async function runInServerless(req: RunRequest): Promise<RunResult> {
  const langOrErr = detectLanguage(req);
  if (typeof langOrErr !== 'string') return langOrErr;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Using a single serverless runner that dispatches by language
  const { Worker } = await import('node:worker_threads');
  // This URL is resolved by Next/Webpack bundling; the .ts will be transpiled.
  const workerUrl = new URL('../workers/serverless-runner.ts', import.meta.url);

  return await new Promise<RunResult>((resolve) => {
    const w = new Worker(workerUrl, { execArgv: [] });
    const timer = setTimeout(() => {
      try { w.terminate(); } catch {}
      resolve({ success: false, output: "Timed out", error: "timeout", timeout: true });
    }, timeoutMs);

    w.on('message', (m: any) => {
      if (m?.type === 'result') {
        clearTimeout(timer);
        try { w.terminate(); } catch {}
        resolve(m.payload as RunResult);
      }
    });
    w.on('error', (err: any) => {
      clearTimeout(timer);
      try { w.terminate(); } catch {}
      resolve(resultFail(err?.stack || String(err), 'runtime_error'));
    });
    w.postMessage({ kind: 'run', req: { ...req, language: langOrErr, timeoutMs } });
  });
}
