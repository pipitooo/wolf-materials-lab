import { z } from "zod";

import {
  signIn,
  createSession,
  sessionCookieHeader,
} from "src/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

export async function POST(req: Request) {
  let body;
  try {
    body = schema.parse(await req.json());
  } catch {
    return Response.json(
      { error: "Provide a valid email and password." },
      { status: 400 },
    );
  }
  const user = signIn(body.email, body.password);
  if (!user)
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  const session = createSession(user.id);
  return Response.json(
    { user },
    { headers: { "Set-Cookie": sessionCookieHeader(session.token, session.maxAge) } },
  );
}
