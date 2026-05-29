import "server-only";

import { redirect } from "next/navigation";

import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/server/supabase/client";

export async function getOptionalUser() {
  if (!hasSupabaseServerEnv()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return user;
}

export async function requireAuthenticatedUser() {
  const user = await getOptionalUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

export async function requireAppSession() {
  const user = await requireAuthenticatedUser();

  return { user };
}

export function requireInternalJob(headerValue?: string | null) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !headerValue || headerValue !== cronSecret) {
    throw new Error("Unauthorized internal job request.");
  }
}
