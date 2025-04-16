import type { Got, RequestError } from "got" with { "resolution-mode": "require" };

export { Got, RequestError };

export async function getGot() {
  return await import("got");
}

export function isGotHTTPError(error: unknown): error is RequestError {
  return error instanceof Error && error.name === "HTTPError";
}
