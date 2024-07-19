import { assertDeepEqual } from "@sergei-dyshel/typescript/error";
import { test } from "@sergei-dyshel/typescript/testing";
import { parseDateRange, useUTCzone } from "../command-line";

useUTCzone();

function date(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second);
}

void test("parse date range", () => {
  const now = date(2024, 8, 10, 14, 30, 40);

  assertDeepEqual(parseDateRange("2024-08-01.", undefined, now), {
    start: date(2024, 8, 1),
    end: now,
  });

  assertDeepEqual(parseDateRange("2024-08-01.1", "2024-08-01.2:3", now), {
    start: date(2024, 8, 1, 1, 0, 0),
    end: date(2024, 8, 1, 2, 3, 59),
  });

  // day larger then current, default to previous month
  assertDeepEqual(parseDateRange("12.", undefined, now), {
    start: date(2024, 7, 12),
    end: now,
  });

  // hour larger then current, default to previous day
  assertDeepEqual(parseDateRange("15", "16", now), {
    start: date(2024, 8, 9, 15),
    end: date(2024, 8, 9, 16, 59, 59),
  });
});
