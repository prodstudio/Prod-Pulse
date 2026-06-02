import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("production env contract", () => {
  it("keeps .env.example aligned with the documented runtime variables", () => {
    const envExample = readFileSync(join(repoRoot, ".env.example"), "utf8");
    const productionSetup = readFileSync(join(repoRoot, "docs/production-setup.md"), "utf8");

    const requiredVariables = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "APP_ENCRYPTION_KEY",
      "CRON_SECRET",
      "INITIAL_OWNER_BOOTSTRAP_TOKEN",
      "SLACK_ALERTS_ENABLED",
      "MONITOR_RUNNER_ENABLED",
      "ALERT_RUNNER_ENABLED",
      "NEXT_PUBLIC_APP_URL",
    ];

    for (const variable of requiredVariables) {
      expect(envExample).toContain(`${variable}=`);
      expect(productionSetup).toContain(variable);
    }
  });
});
