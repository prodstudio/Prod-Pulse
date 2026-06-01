"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { ApiError, getActionErrorRedirectValue } from "@/lib/server/api/errors";
import {
  AuthIdentity,
  bootstrapInitialOwner,
  syncProfileFromAuthIdentity,
} from "@/lib/server/auth/bootstrap-service";
import {
  getDefaultPostLoginPath,
  sanitizeRedirectTarget,
} from "@/lib/server/auth/redirects";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/server/supabase/client";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

const bootstrapSchema = z.object({
  organizationName: z.string().trim().min(2).max(80),
  organizationSlug: z.string().trim().min(2).max(80),
  fullName: z.string().trim().max(120).optional(),
  bootstrapToken: z.string().trim().min(1),
});

function toAuthIdentity(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): AuthIdentity {
  const metadata = user.user_metadata ?? {};

  return {
    id: user.id,
    email: user.email ?? null,
    fullName:
      typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.name === "string"
          ? metadata.name
          : null,
    avatarUrl:
      typeof metadata.avatar_url === "string"
        ? metadata.avatar_url
        : typeof metadata.picture === "string"
          ? metadata.picture
          : null,
  };
}

export async function signInWithPasswordAction(formData: FormData) {
  if (!hasSupabaseServerEnv()) {
    redirect("/login?error=request_failed");
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    redirect("/login?error=validation_failed");
  }

  const redirectTarget = sanitizeRedirectTarget(parsed.data.next, getDefaultPostLoginPath());
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error || !data.user) {
      throw new ApiError(401, "unauthorized", "Authentication required.");
    }

    await syncProfileFromAuthIdentity(toAuthIdentity(data.user));
  } catch (error) {
    redirect(
      `/login?error=${getActionErrorRedirectValue(error)}&next=${encodeURIComponent(redirectTarget)}`,
    );
  }

  redirect(redirectTarget);
}

export async function signOutAction() {
  try {
    if (hasSupabaseServerEnv()) {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    }
  } catch {
    redirect("/dashboard?error=request_failed");
  }

  redirect("/login?status=signed_out");
}

export async function bootstrapInitialOwnerAction(formData: FormData) {
  if (!hasSupabaseServerEnv()) {
    redirect("/dashboard?error=request_failed");
  }

  const parsed = bootstrapSchema.safeParse({
    organizationName: formData.get("organizationName"),
    organizationSlug: formData.get("organizationSlug"),
    fullName: formData.get("fullName"),
    bootstrapToken: formData.get("bootstrapToken"),
  });

  if (!parsed.success) {
    redirect("/dashboard?error=validation_failed");
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError(401, "unauthorized", "Authentication required.");
    }

    await bootstrapInitialOwner({
      user: toAuthIdentity(user),
      organizationName: parsed.data.organizationName,
      organizationSlug: parsed.data.organizationSlug,
      fullName: parsed.data.fullName,
      bootstrapToken: parsed.data.bootstrapToken,
    });
  } catch (error) {
    const code = getActionErrorRedirectValue(error);
    if (code === "unauthorized") {
      redirect("/login?error=unauthorized");
    }
    redirect(`/dashboard?error=${code}`);
  }

  redirect("/dashboard?status=bootstrap_complete");
}
