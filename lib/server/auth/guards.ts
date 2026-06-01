import { redirect } from "next/navigation";

import { ApiError } from "@/lib/server/api/errors";
import { getActiveOrganizationForUser } from "@/lib/server/auth/organization-context";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/server/supabase/client";

type SupabaseUser = {
  id: string;
  email?: string | null;
};

type RequireUserOptions = {
  redirectToLogin?: boolean;
};

export async function getCurrentUser(): Promise<SupabaseUser | null> {
  if (!hasSupabaseServerEnv()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
  };
}

export async function getOptionalUser() {
  return getCurrentUser();
}

export async function requireUser(
  options: RequireUserOptions = {},
): Promise<SupabaseUser> {
  const user = await getCurrentUser();

  if (user) {
    return user;
  }

  if (options.redirectToLogin) {
    redirect("/login");
  }

  throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication required.");
}

export async function requireAuthenticatedUser() {
  return requireUser({ redirectToLogin: true });
}

export async function requireAppSession() {
  const user = await requireUser({ redirectToLogin: true });
  const organizationContext = await getActiveOrganizationForUser(user.id);

  return {
    user,
    organizationContext,
  };
}

export function requireInternalJob(headerValue: string | null) {
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || headerValue !== expectedSecret) {
    throw new Error("Unauthorized internal job execution.");
  }
}
