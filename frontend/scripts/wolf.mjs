import { resolve } from "node:path";
import { existsSync, renameSync } from "node:fs";
import { openEngine } from "../src/server/evidence.ts";

const action = process.argv[2];
if (action === "reset") {
  // Preserve previous evidence: reset archives the database rather than deleting it.
  const path = process.env.WOLF_DB_PATH ?? resolve(".wolf/evidence.sqlite");
  if (existsSync(path)) {
    const engine = openEngine();
    engine.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    engine.close();
    const archive = `${path}.${Date.now()}.backup`;
    renameSync(path, archive);
    console.log(`Archived: ${archive}`);
  }
  const engine = openEngine();
  engine.close();
  console.log("Empty evidence store ready.");
} else if (action === "worker") {
  console.log(
    "Local simulated worker; checks the durable queue every 2 seconds. Ctrl+C stops.",
  );
  setInterval(() => {
    const engine = openEngine();
    try {
      const result = engine.tick();
      engine.auditSources();
      if (result.processed || result.error) console.log(result);
    } finally {
      engine.close();
    }
  }, 2000);
} else {
  const engine = openEngine();
  try {
    if (action === "seed") {
      for (const market of ["FR", "HU"]) {
        engine.deliver(market, "v1");
        console.log(engine.tick());
      }
    } else if (action === "deliver") {
      console.log(engine.deliver(process.argv[3] ?? "FR", "v2"));
    } else {
      console.error("Use seed | reset | worker | deliver FR | deliver HU");
      process.exitCode = 1;
    }
  } finally {
    engine.close();
  }
}
