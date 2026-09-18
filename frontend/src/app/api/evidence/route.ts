import { z } from "zod";

import { currentUser } from "src/server/auth";
import { openEngine } from "src/server/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("deliver"),
      market: z.enum(["FR", "HU"]),
      version: z.enum(["v1", "v2"]),
      eventId: z.string().min(1).max(120).optional(),
    })
    .strict(),
  z.object({ action: z.literal("tick") }).strict(),
  z
    .object({
      action: z.literal("approve"),
      findingId: z.string(),
    })
    .strict(),
  z
    .object({
      action: z.literal("correct"),
      recordId: z.string(),
      qty: z.number(),
      unit: z.enum(["piece", "box", "kg", "g", "l", "ml"]),
      pack: z.number().nullable(),
      reason: z.string(),
    })
    .strict(),
]);
export async function GET() {
  const engine = openEngine();
  try {
    engine.auditSources();
    const state = engine.state();
    // Full source snapshots stay server side; individual original rows are inspectable.
    return Response.json(
      {
        ...state,
        events: state.events.map((e) => ({
          ...e,
          sources: e.sources.map(({ text, ...source }) => source),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    engine.close();
  }
}
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  // Next's internal URL may use localhost while the browser uses 127.0.0.1.
  // Match the browser origin to the actual request Host, not that internal URL.
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.get("host"))
        return Response.json(
          { error: "Cross-origin mutation denied" },
          { status: 403 },
        );
    } catch {
      return Response.json({ error: "Invalid origin" }, { status: 403 });
    }
  }
  const engine = openEngine();
  try {
    const text = await req.text();
    if (text.length > 10000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    const body = actionSchema.parse(JSON.parse(text));
    const user = currentUser(req);
    let result;
    switch (body.action) {
      case "deliver":
        result = engine.deliver(body.market, body.version, body.eventId);
        break;
      case "tick":
        result = engine.tick();
        break;
      case "approve":
        if (!user)
          return Response.json(
            { error: "Sign in before approving." },
            { status: 401 },
          );
        result = engine.approve(body.findingId, user.name);
        break;
      case "correct": {
        if (!user)
          return Response.json(
            { error: "Sign in before correcting a record." },
            { status: 401 },
          );
        result = engine.correct({
          recordId: body.recordId,
          qty: body.qty,
          unit: body.unit,
          pack: body.pack,
          reviewer: user.name,
          reason: body.reason,
        });
        break;
      }
      default:
        throw new Error("Unknown action");
    }
    return Response.json(result, {
      status: result && "error" in result ? 409 : 200,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 409 },
    );
  } finally {
    engine.close();
  }
}
