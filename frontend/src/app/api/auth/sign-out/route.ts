import {
  parseCookies,
  deleteSession,
  SESSION_COOKIE,
  clearCookieHeader,
} from "src/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (token) deleteSession(token);
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearCookieHeader() } },
  );
}
