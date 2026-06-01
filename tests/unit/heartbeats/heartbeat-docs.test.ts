import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("heartbeat docs", () => {
  it("does not include real secrets in examples", () => {
    const docs = readFileSync(
      "/Users/danielhernandes/Documents/Prod Pulse/docs/heartbeat-integration.md",
      "utf8",
    );

    expect(docs).not.toContain("hooks.slack.com/services/T000");
    expect(docs).not.toContain("SUPABASE_SERVICE_ROLE_KEY=");
    expect(docs).not.toContain("postgres://user:pass@");
  });
});
