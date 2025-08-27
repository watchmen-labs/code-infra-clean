/**
 * Public browser API for the isomorphic autograder (client-only).
 * Spawns a dedicated worker per run; no Next API routes are used.
 */
import type { RunRequest, RunResult, Language } from './types';
import { DEFAULT_TIMEOUT_MS } from './types';
import { detectLanguage } from './detect-language';

export async function runAutograder(req: RunRequest): Promise<RunResult> {
  const langOrErr = detectLanguage(req);
  if (typeof langOrErr !== 'string') return langOrErr;
  const lang: Language = langOrErr;

  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Use module workers that bundle with Next/Webpack: new URL(..., import.meta.url)
  const workerUrl =
    lang === 'js'
      ? new URL('./workers/js-runner.ts', import.meta.url)
      : lang === 'python'
      ? new URL('./workers/python-runner.ts', import.meta.url)
      : new URL('./workers/ocaml-runner.ts', import.meta.url);

  const worker = new Worker(workerUrl, { type: 'module' });

  return await new Promise<RunResult>((resolve) => {
    const timer = setTimeout(() => {
      try { worker.terminate(); } catch { /* noop */ }
      resolve({ success: false, output: 'Timed out', error: 'timeout', timeout: true });
    }, timeoutMs);

    worker.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === 'result') {
        clearTimeout(timer);
        try { worker.terminate(); } catch {}
        resolve(d.payload as RunResult);
      }
    };

    const assetsBase = `${location.origin}/runtimes`;
    worker.postMessage({ kind: 'run', req: { ...req, language: lang, timeoutMs }, assetsBase });
  });
}

export { detectLanguage } from './detect-language';
export type { RunRequest, RunResult, Language } from './types';
