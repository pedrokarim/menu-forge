/** Mise en forme des textes affichés (dates, quantités), en français. */

/** Espace insécable, avant « : », « ; », « ! », « ? ». */
export const NBSP = String.fromCharCode(160);

const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const absolute = new Intl.DateTimeFormat('fr', { dateStyle: 'long', timeStyle: 'short' });

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['minute', 60],
  ['hour', 3600],
  ['day', 86_400],
  ['week', 604_800],
  ['month', 2_629_800],
  ['year', 31_557_600],
];

/** « à l’instant », « il y a 5 minutes », « hier »… */
export function formatRelative(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'date inconnue';
  const seconds = Math.round((time - now) / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 45) return 'à l’instant';
  let unit = UNITS[0];
  for (const candidate of UNITS) if (magnitude >= candidate[1]) unit = candidate;
  return relative.format(Math.round(seconds / unit[1]), unit[0]);
}

/** « 11 septembre 2026 à 14:05 ». */
export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? absolute.format(time) : 'date inconnue';
}

/** « 1 menu », « 3 menus ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count}${NBSP}${count > 1 ? pluralForm : singular}`;
}
