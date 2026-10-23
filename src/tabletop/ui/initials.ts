/** One or two letters for an avatar: first and last word of a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => Array.from(part)[0] ?? '').join('').toLocaleUpperCase() || '?';
}
