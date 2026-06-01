import { describe, expect, it } from "vitest";

import {
  canManageOperationalConfig,
  canReadOrganization,
  hasRoleAtLeast,
} from "@/lib/server/auth/permissions";

describe("organization permissions", () => {
  it("viewer cannot create or manage apps", () => {
    expect(canManageOperationalConfig("viewer")).toBe(false);
  });

  it("admin can create and manage apps", () => {
    expect(canManageOperationalConfig("admin")).toBe(true);
  });

  it("role ladder remains ordered", () => {
    expect(hasRoleAtLeast("owner", "admin")).toBe(true);
    expect(hasRoleAtLeast("responder", "admin")).toBe(false);
    expect(canReadOrganization("viewer")).toBe(true);
  });
});
