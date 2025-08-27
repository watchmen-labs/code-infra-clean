// BigInt-safe deep equality with good coverage for arrays, objects, dates, regexps.
export function deepEqual(a: any, b: any, seen = new WeakMap()): boolean {
  if (Object.is(a, b)) return true;

  // NaN equality covered by Object.is; handle nulls and types quickly
  if (a == null || b == null) return a === b;
  const ta = typeof a, tb = typeof b;
  if (ta !== tb) return false;

  // Primitives (including bigint, string, number, boolean, symbol)
  if (ta !== 'object') return a === b;

  // Handle Dates
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();

  // RegExps
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;

  // Typed arrays
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.constructor !== b.constructor || (a as any).length !== (b as any).length) return false;
    for (let i = 0; i < (a as any).length; i++) if ((a as any)[i] !== (b as any)[i]) return false;
    return true;
  }

  // Cycles
  if (seen.get(a) === b) return true;
  seen.set(a, b);

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i], seen)) return false;
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;

  // Plain objects
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  ka.sort(); kb.sort();
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k], seen)) return false;

  return true;
}
