import { describe, expect, it } from "vitest";

import {
  buildLoginRedirectPath,
  getDefaultPostLoginPath,
  isProtectedAppPath,
  sanitizeRedirectTarget,
} from "@/lib/server/auth/redirects";

describe("auth redirect helpers", () => {
  it("keeps safe relative redirects", () => {
    expect(sanitizeRedirectTarget("/monitors/123?tab=results")).toBe("/monitors/123?tab=results");
  });

  it("blocks external and auth-loop redirects", () => {
    expect(sanitizeRedirectTarget("https://evil.example")).toBe(getDefaultPostLoginPath());
    expect(sanitizeRedirectTarget("//evil.example")).toBe(getDefaultPostLoginPath());
    expect(sanitizeRedirectTarget("/login?next=/apps")).toBe(getDefaultPostLoginPath());
    expect(sanitizeRedirectTarget("/api/admin")).toBe(getDefaultPostLoginPath());
  });

  it("builds login redirect paths with sanitized next values", () => {
    expect(buildLoginRedirectPath("/monitors", "?filter=down")).toBe(
      "/login?next=%2Fmonitors%3Ffilter%3Ddown",
    );
  });

  it("recognizes protected app paths only", () => {
    expect(isProtectedAppPath("/dashboard")).toBe(true);
    expect(isProtectedAppPath("/alerts/channels")).toBe(true);
    expect(isProtectedAppPath("/login")).toBe(false);
  });
});
