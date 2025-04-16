import type { AxiosError } from "axios";
export { AxiosError, type AxiosInstance } from "axios";

export function isAxiosError(error: unknown): error is AxiosError {
  return error instanceof Error && error.name === "AxiosError";
}
