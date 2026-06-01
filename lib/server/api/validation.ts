import type { ZodType } from "zod";
import { ZodError } from "zod";

import { ApiError } from "@/lib/server/api/errors";

export async function parseJsonBody<TSchema>(
  request: Request,
  schema: ZodType<TSchema>,
): Promise<TSchema> {
  let json: unknown;

  try {
    json = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  try {
    return schema.parse(json);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.", {
        issues: error.flatten(),
      });
    }

    throw error;
  }
}

export function parseSchema<TSchema>(schema: ZodType<TSchema>, input: unknown): TSchema {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed.", {
        issues: error.flatten(),
      });
    }

    throw error;
  }
}
