import { randomInt } from "node:crypto";

/**
 * String composed of random characters from given set
 */
export function randomChars(length: number, chars: string) {
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join("");
}

/**
 * String composed of random alphanumeric characters (0-9, a-z, A-Z)
 */
export function randomAlphaNumChars(length: number) {
  return randomChars(length, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
}
