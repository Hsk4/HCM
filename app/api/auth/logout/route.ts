import { destroySession } from "@/server/auth/session";

/**
 * @fileoverview Sign-out endpoint.
 *
 * @description
 * Clears the session cookie. The shell posts to this route with a plain
 * `<form method="post">`, so the redirect is done by the server rather than
 * the client — that keeps sign-out working with JavaScript disabled.
 *
 * @see server/auth/session.ts
 */

/**
 * Destroys the session and redirects to `/login`.
 *
 * @returns A 303 redirect to the login page.
 */
export async function POST(req: Request) {
  await destroySession();
  return Response.redirect(new URL("/login", req.url), 303);
}
