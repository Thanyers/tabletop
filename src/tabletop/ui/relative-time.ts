// Short "updated 5 min ago" labels for the table list (F053).

const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60_000], ['hour', 3_600_000], ['day', 86_400_000], ['week', 604_800_000], ['month', 2_629_800_000], ['year', 31_557_600_000],
];

/** "just now" under a minute, then the largest whole unit ("3 hours ago", "2 weeks ago"). */
export function relativeTime(at: number, now: number, locale = 'en'): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 60_000) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
  let unit = steps[0];
  for (const step of steps) if (elapsed >= step[1]) unit = step;
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-Math.floor(elapsed / unit[1]), unit[0]);
}

/** Case- and accent-insensitive match of every typed word against any of the fields. */
export function matchesSearch(query: string, fields: readonly string[]): boolean {
  // Strip only Latin accents (U+0300–036F); Thai vowels and tone marks are letters people type.
  const fold = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').normalize('NFC').toLocaleLowerCase();
  const haystack = fold(fields.join(' '));
  return fold(query).split(/\s+/u).filter(Boolean).every((word) => haystack.includes(word));
}
