/**
 * @fileoverview Password hashing and temporary-password generation.
 *
 * @description
 * Uses bcrypt for both hashing and verification (cost 10 — ~100 ms on typical
 * hardware, which is the intended defence against offline cracking). Temporary
 * passwords are generated with a CSPRNG and shown once to HR at employee
 * creation; the user must change it on first sign-in.
 *
 * @implementation
 *
 * Step 1: Hash on write — `hashPassword`.
 * Step 2: Compare on read — `verifyPassword` (constant-time inside bcrypt).
 * Step 3: Generate temp passwords with `crypto.randomBytes`.
 * Step 4: Errors propagate to the caller as rejected promises.
 * Step 5: Used by `auth/login`, `auth/change-password`, `services/setup`,
 *         `services/employee.service`.
 * Step 6: A wrong password must return `false`, never throw.
 *
 * @author HMS team
 * @version 1.0.0
 * @since 2026-10-24
 */

// ── Step 1: dependencies ──────────────────────────────────────────────────────
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

/**
 * Hashes a plaintext password.
 *
 * @param p Plaintext password.
 * @returns bcrypt hash (includes salt and cost).
 */
export const hashPassword = (p: string) => bcrypt.hash(p, 10);

/**
 * Checks a plaintext password against a stored hash.
 *
 * @param p    Plaintext password supplied by the user.
 * @param hash Stored bcrypt hash.
 * @returns `true` when the password matches.
 */
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(p, hash);

/**
 * Generates a URL-safe temporary password (12 characters, 72 bits of entropy).
 *
 * @returns A fresh temporary password.
 */
export function tempPassword() {
  return randomBytes(9).toString("base64url");
}
