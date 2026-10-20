import { createClient } from "@supabase/supabase-js";
import { RequestError } from "./request-validation";

export async function requireUser(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length < 8)
    throw new RequestError("Sign in to continue.", 401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new RequestError("Account service is not configured.", 503);
  const db = createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { data, error } = await db.auth.getUser(authorization.slice(7));
  if (error || !data.user)
    throw new RequestError("Your session expired. Sign in again.", 401);
  return { db, user: data.user };
}

export function apiError(error: unknown) {
  if (error instanceof RequestError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  // Never return provider payloads or journal contents to logs or clients.
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number(error.status)
      : 0;
  return Response.json(
    {
      error:
        status === 429
          ? "Gemini allowance reached. Try again later."
          : "Processing failed. Your draft has not been cleared. Please try again.",
    },
    {
      status: status === 429 ? 429 : 502,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
