/**
 * @fileoverview Typed application errors and the single JSON error formatter.
 *
 * @description
 * Services throw `AppError` for anything the client can act on (validation,
 * permission, conflict) and let unexpected errors bubble. `errorResponse`
 * converts either into the one response envelope every route returns:
 *
 * ```json
 * { "error": { "code": "FORBIDDEN", "message": "Not allowed", "details": null } }
 * ```
 *
 * A Zod failure is mapped to 400 `VALIDATION` automatically, so routes don't
 * need a try/catch for parsing.
 *
 * @implementation
 *
 * Step 1: Define `AppError` with status + stable machine-readable code.
 * Step 2: Provide small constructors for the common cases.
 * Step 3: Map `ZodError` to 400 `VALIDATION` with flattened issues.
 * Step 4: Log unexpected errors server-side, return a generic 500 (never leak
 *         internal messages or stack traces).
 *
 * Step 5: Integration — `guard.ts` and every route handler use `errorResponse`;
 *         `lib/api.ts` on the client unwraps `error.message`.
 *
 * Step 6: Verification — an unexpected throw must not reveal internals; a
 *         `forbidden()` must be 403 `FORBIDDEN`.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Steps 1–2: error type and constructors ────────────────────────────────────
import { ZodError } from "zod";

/** An expected, client-facing failure with an HTTP status and stable code. */
export class AppError extends Error {
  /**
   * @param status  HTTP status to send.
   * @param code    Stable machine code, e.g. `"RATE_LIMITED"`.
   * @param message Human-readable message safe to show the user.
   * @param details Optional structured details (validation issues, conflicts…).
   */
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}

/** 400 — malformed or invalid input. */
export const badRequest = (m: string, d?: unknown) => new AppError(400, "BAD_REQUEST", m, d);
/** 403 — authenticated but not permitted. */
export const forbidden = (m = "You are not allowed to do this") => new AppError(403, "FORBIDDEN", m);
/** 404 — resource does not exist (or is invisible to the caller). */
export const notFound = (m = "Not found") => new AppError(404, "NOT_FOUND", m);
/** 409 — state conflict (duplicate, already finalized…). */
export const conflict = (m: string) => new AppError(409, "CONFLICT", m);
/** 422 — well-formed but violates a business rule. */
export const unprocessable = (m: string, d?: unknown) => new AppError(422, "UNPROCESSABLE", m, d);

// ── Steps 3–4: response mapping ───────────────────────────────────────────────

/**
 * Converts any thrown value into the standard JSON error response.
 *
 * @param e The caught error.
 * @returns A `Response` with the app's error envelope.
 */
export function errorResponse(e: unknown) {
  if (e instanceof AppError)
    return Response.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  if (e instanceof ZodError)
    return Response.json({ error: { code: "VALIDATION", message: "Invalid input", details: e.flatten() } }, { status: 400 });
  console.error(e);
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
}
