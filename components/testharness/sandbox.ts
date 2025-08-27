/** Disable network APIs *for user code* within workers. Call this *after* you finish bootstrapping runtimes. */
export function disableNetworkInWorker() {
  try {
    const deny = () => { throw new Error('Network access is disabled inside the autograder sandbox'); };
    // @ts-ignore
    globalThis.fetch = deny;
    // @ts-ignore
    globalThis.XMLHttpRequest = function () { throw new Error('Network disabled'); };
    // @ts-ignore
    globalThis.WebSocket = function () { throw new Error('Network disabled'); };
    // @ts-ignore
    globalThis.EventSource = function () { throw new Error('Network disabled'); };
    try { (globalThis as any).navigator = { ...(globalThis as any).navigator, onLine: false }; } catch { /* ignore */ }
  } catch { /* ignore */ }
}
