import { currentUser } from "src/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = currentUser(req);
  if (!user) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user });
}
