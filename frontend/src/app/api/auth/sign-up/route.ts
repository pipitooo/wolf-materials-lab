import { z } from "zod";

import {
  signUp,
  createSession,
  sessionCookieHeader,
} from "src/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(6).max(200),
});

export async function POST(req: Request) {
  let body;
  try {
    body = schema.parse(await req.json());
  } catch {
    return Response.json(
      { error: "Provide a name, email and password (6+ characters)." },
      { status: 400 },
    );
  }
  try {
    const user = signUp(body.name, body.email, body.password);
    const session = createSession(user.id);
    return Response.json(
      { user },
      {
        headers: {
          "Set-Cookie": sessionCookieHeader(session.token, session.maxAge),
        },
      },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Sign up failed." },
      { status: 409 },
    );
  }
}
