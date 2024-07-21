import { RegExpWithNamedGroups } from "@sergei-dyshel/typescript";
import { assert, assertNotNull } from "@sergei-dyshel/typescript/error";

const timestampRegex = new RegExpWithNamedGroups(
  "^(((((?<year>\\d+)-)?(?<month>\\d+)-)?(?<day>\\d+))\\.)?((?<hour>\\d+)(:(?<minute>\\d+)(:(?<second>\\d+))?)?)?$",
);

export function parseDateRange(start: string, end?: string, now?: Date) {
  if (!now) now = new Date();
  const startDate = parseTimestamp(start, now);
  const endDate = end ? parseTimestamp(end, now, true /* end */) : now;
  return { start: startDate, end: endDate };
}

export function parseTimestamp(ts: string, now: Date, end = false) {
  assert(ts != "", "Timestamp cannot be empty");
  const match = timestampRegex.exec(ts);
  assertNotNull(match, `Invalid timestamp format: ${ts}`);

  const groups = match.groups!;
  const second = groups.second ? parseInt(groups.second) : end ? 59 : 0;
  const minute = groups.minute ? parseInt(groups.minute) : end ? 59 : 0;
  const hour = groups.hour ? parseInt(groups.hour) : end ? 23 : 0;

  const day = groups.day
    ? parseInt(groups.day)
    : // if parsed hour is in the future, assume yesterday
      groups.hour && hour > now.getHours()
      ? dateAddDays(now, { days: -1 }).getDate()
      : now.getDate();

  const month = groups.month
    ? parseInt(groups.month) - 1
    : // if parsed day is in the future, assume previous month
      groups.day && day > now.getDate()
      ? dateAddDays(now, { months: -1 }).getMonth()
      : now.getMonth();

  const year = groups.year
    ? parseInt(groups.year)
    : // if parsed month is in the future, assume previous year
      groups.month && month > now.getMonth()
      ? dateAddDays(now, { months: -1 }).getMonth()
      : now.getFullYear();

  return new Date(year, month, day, hour, minute, second);
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

/** Make `Date` use UTC timezone by default */
export function useUTCzone() {
  process.env.TZ = "UTC";
}
