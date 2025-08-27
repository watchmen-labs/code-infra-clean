export type Language = 'js' | 'python' | 'ocaml';

export type RunRequest = {
  solution: string;
  tests: string;
  language?: Language;   // optional; auto-detect if absent
  timeoutMs?: number;    // default 60000
  memoryMb?: number;     // reserved for future use
};

export type RunResult = {
  success: boolean;
  output: string;
  error: string | null;  // "compile_error" | "timeout" | "runtime_error" | "tests_failed" | "bad_language_detection"
  timeout: boolean;
};

export const DEFAULT_TIMEOUT_MS = 60_000;

export function resultOk(output: string): RunResult {
  return { success: true, output, error: null, timeout: false };
}
export function resultFail(output: string, error: NonNullable<RunResult['error']>, timeout = false): RunResult {
  return { success: false, output, error, timeout };
}
