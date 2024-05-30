import { strip } from "ansicolor";

export * from "ansicolor";
export { strip as stripAnsi };

export type ColorizeFunction = (_: string) => string;
