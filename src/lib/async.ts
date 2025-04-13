import { fail } from "@sergei-dyshel/typescript/error";
import { setTimeout } from "node:timers/promises";

export async function waitForever() {
  async function internal() {
    await setTimeout(10 * 1000); // 10 seconds
    await internal();
  }
  await internal();
  fail("Should never get here");
}
