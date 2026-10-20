// Check untrusted values before recursive schema parsers and canonical hashing.
// Byte limits still apply at transport/provider boundaries.
export function jsonWithinBudget(value: unknown, maxDepth = 96, maxNodes = 30_000): boolean {
  const pending: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (entry.exit) {
      ancestors.delete(entry.value as object);
      continue;
    }
    if (++nodes > maxNodes || entry.depth > maxDepth) return false;
    const current = entry.value;
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (!current || typeof current !== 'object' || ancestors.has(current)) return false;
    ancestors.add(current);
    if (!Array.isArray(current)) {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== null && prototype !== Object.prototype) return false;
    }
    const entries = Object.entries(current);
    if (entries.length + pending.length + nodes > maxNodes) return false;
    pending.push({ value: current, depth: entry.depth, exit: true });
    for (const [key, child] of entries) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return false;
      pending.push({ value: child, depth: entry.depth + 1 });
    }
  }
  return true;
}
