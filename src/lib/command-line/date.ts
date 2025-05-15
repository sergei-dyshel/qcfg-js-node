import { RegExpWithNamedGroups, type RegExpWithNamedGroupsType } from "@sergei-dyshel/typescript";
import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";

const DATE_REGEX = new RegExpWithNamedGroups("((?<year>\\d+)-)?(?<month>\\d+)-(?<day>\\d+)");

const TIMESTAMP_REGEX = new RegExpWithNamedGroups(
  "^(((((?<year>\\d+)-)?(?<month>\\d+)-)?(?<day>\\d+))\\.)?((?<hour>\\d+)(:(?<minute>\\d+)(:(?<second>\\d+))?)?)?$",
);

const DURATION_REGEX = new RegExpWithNamedGroups(
  "((?<weeks>\\d+)w)?((?<days>\\d+)d)?((?<hours>\\d+)h)?((?<minutes>\\d+)m)?",
);

interface ParseDateOptions {
  now?: Date;
  /** Round to end of hour (e.g. 23:00 => 23:59:59) */
  roundEnd?: boolean;
}

/**
 * Parse date/time range.
 *
 * If start/end timestamp is not provided, assume "now".
 */
export function parseDateRange(start?: string, end?: string, options?: ParseDateOptions) {
  const now = options?.now ?? new Date();
  const startDate = parseTimestamp(start, { ...options, now });
  const endDate = end ? parseTimestamp(end, { ...options, now, start: startDate }) : now;
  return { start: startDate, end: endDate };
}

/**
 * Like {@link parseDateRange} but do not assume "now" for missing start/end.
 */
export function parseOptionalDateRange(start?: string, end?: string, options?: ParseDateOptions) {
  const now = options?.now ?? new Date();
  const startDate = start ? parseTimestamp(start, { ...options, now }) : null;
  const endDate = end ? parseTimestamp(end, { ...options, now, start: startDate }) : undefined;
  return { start: startDate, end: endDate };
}

function myParseInt<D>(s: string | undefined, defaultValue: D): D | number {
  return s ? parseInt(s) : defaultValue;
}

/**
 * Parse start or end timestamp of time range.
 *
 * @param ts If undefined, assume "now".
 */
export function parseTimestamp(
  ts: string | undefined,
  options?: ParseDateOptions & {
    /**
     * When not undefined, we are parsing end timestamp (use `null` when start timestamp is missing)
     */
    start?: Date | null;
  },
) {
  const start = options?.start;
  const now = options?.now ?? new Date();
  // by default return inverval from one hour ago until now
  if (ts === undefined) return start ? now : new Date(now.getTime() - 60 * 60 * 1000);

  assert(ts != "", "Timestamp cannot be empty");
  const match =
    TIMESTAMP_REGEX.exec(ts) ??
    (DATE_REGEX.exec(ts) as unknown as RegExpWithNamedGroupsType<typeof TIMESTAMP_REGEX> | null);
  if (!match) {
    const match = DURATION_REGEX.exec(ts);
    assertNotNull(match, `Invalid timestamp format: ${ts}`);

    const totalDuration =
      (myParseInt(match.groups?.minutes, 0) +
        (myParseInt(match.groups?.hours, 0) +
          (myParseInt(match.groups?.days, 0) + myParseInt(match.groups?.weeks, 0) * 7) * 24) *
          60) *
      60;

    return start
      ? new Date(start.getTime() + totalDuration * 1000)
      : new Date(now.getTime() - totalDuration * 1000);
  }
  assertNotNull(match, `Invalid timestamp format: ${ts}`);

  const groups = match.groups!;
  const roundEnd = start !== undefined && options?.roundEnd;
  const second = groups.second ? parseInt(groups.second) : roundEnd ? 59 : 0;
  const minute = groups.minute ? parseInt(groups.minute) : roundEnd ? 59 : 0;
  const hour = groups.hour ? parseInt(groups.hour) : roundEnd ? 23 : 0;

  const base = start ?? now;

  const day = myParseInt(groups.day, base.getDate());
  const month = myParseInt(groups.month, base.getMonth() + 1) - 1;
  const year = myParseInt(groups.year, base.getFullYear());

  const date = new Date(year, month, day, hour, minute, second);

  for (const delta of [{ days: 1 }, { months: 1 }, { years: 1 }]) {
    if (start) {
      // parsing end date
      if (date.getTime() <= start.getTime()) {
        const fixed = dateAddDays(date, delta);
        if (fixed.getTime() > start.getTime()) return fixed;
      }
    } else {
      // parsing start date
      if (date.getTime() > now.getTime()) {
        const fixed = dateSubtractDays(date, delta);
        if (fixed.getTime() <= now.getTime()) return fixed;
      }
    }
  }

  return date;
}

export function dateAddTime(
  date: Date,
  delta: {
    weeks?: number;
    days?: number;
    hours?: number;
    minutes?: number;
    seconds?: number;
    milliseconds?: number;
  },
) {
  const total =
    (delta.milliseconds ?? 0) +
    (delta.seconds ?? 0) * 1000 +
    (delta.minutes ?? 0) * 60 * 1000 +
    (delta.hours ?? 0) * 60 * 60 * 1000 +
    (delta.days ?? 0) * 24 * 60 * 60 * 1000 +
    (delta.weeks ?? 0) * 7 * 24 * 60 * 60 * 1000;

  return new Date(date.getTime() + total);
}

export function dateAddDays(date: Date, delta: { days?: number; months?: number; years?: number }) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + (delta.years ?? 0));
  d.setMonth(d.getMonth() + (delta.months ?? 0));
  d.setDate(d.getDate() + (delta.days ?? 0));
  return d;
}

export function dateSubtractDays(
  date: Date,
  delta: { days?: number; months?: number; years?: number },
) {
  const neg = (a: number | undefined) => (a ? -a : undefined);
  return dateAddDays(date, {
    days: neg(delta.days),
    months: neg(delta.months),
    years: neg(delta.years),
  });
}

/** Make `Date` use UTC timezone by default */
export function useUTCzone() {
  process.env.TZ = "UTC";
}
