import { InvalidArgumentError } from "@commander-js/extra-typings";

export * from "@commander-js/extra-typings";

export function commanderParseInt(value: string, _: unknown) {
  const parsed = parseInt(value);
  if (isNaN(parsed)) {
    throw new InvalidArgumentError(`Not a number: ${value}`);
  }
  return parsed;
}

export function commanderIncreaseVerbosity(_value: unknown, previous: number) {
  return previous + 1;
}
