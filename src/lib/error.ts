import { isMatching, P } from "@sergei-dyshel/typescript/pattern";

/**
 * Any error in NodeJS
 */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  const matching = isMatching({
    errno: P.number.optional(),
    code: P.string.optional(),
    path: P.string.optional(),
    syscall: P.string.optional(),
  });
  return err instanceof Error && matching(err);
}
