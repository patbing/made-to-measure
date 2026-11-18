import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cmdVerify } from "../skills/made-to-measure/scripts/fit.mjs";

// The zine example: five slots share one picsum URL; only the failed tote should still use it.
test("verify tells wired slots apart when several share one placeholder URL", () => {
  const dir = mkdtempSync(join(tmpdir(), "mtm-verify-"));
  cpSync(new URL("../examples/zine/after", import.meta.url), dir, { recursive: true });
  assert.equal(cmdVerify(dir), 0);
  const page = join(dir, "index.html");
  writeFileSync(page, readFileSync(page, "utf8").replace("img/riso.jpg", "https://picsum.photos/600/600"));
  assert.equal(cmdVerify(dir), 2);
});
