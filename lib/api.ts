/**
 * Thin client for the app's REST endpoints. Endpoints reply with
 * `{ error: { code, message, details } }` on failure (see server/errors.ts),
 * so surface that message instead of a bare status code.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const message =
      data?.error?.message ??
      (res.status === 401
        ? "Please sign in again."
        : res.status === 403
          ? "You are not allowed to do this."
          : `Request failed (${res.status}).`);
    throw new Error(message);
  }
  return data as T;
}
