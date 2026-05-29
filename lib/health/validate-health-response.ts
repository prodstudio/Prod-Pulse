import { healthResponseSchema, type HealthResponse } from "@/lib/health/contract";

type ValidateHealthResponseOptions = {
  maxAgeMs?: number;
  requiredChecks?: string[];
  now?: Date;
};

type ValidationSuccess = {
  success: true;
  data: HealthResponse;
  errors: [];
};

type ValidationFailure = {
  success: false;
  data: null;
  errors: string[];
};

export type HealthValidationResult = ValidationSuccess | ValidationFailure;

function checkPathExists(response: HealthResponse, path: string) {
  const segments = path.split(".");
  let current: unknown = response.checks;

  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return false;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current !== undefined;
}

export function validateHealthResponse(
  input: unknown,
  options: ValidateHealthResponseOptions = {},
): HealthValidationResult {
  const parsed = healthResponseSchema.safeParse(input);

  if (!parsed.success) {
    return {
      success: false,
      data: null,
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const response = parsed.data;
  const errors: string[] = [];
  const timestamp = new Date(response.timestamp);

  if (Number.isNaN(timestamp.getTime())) {
    errors.push("timestamp must be a valid ISO-8601 date string");
  }

  if (options.maxAgeMs !== undefined && !Number.isNaN(timestamp.getTime())) {
    const referenceTime = options.now ?? new Date();
    const ageMs = referenceTime.getTime() - timestamp.getTime();

    if (ageMs > options.maxAgeMs) {
      errors.push("timestamp is older than the allowed maxAgeMs");
    }
  }

  for (const requiredCheck of options.requiredChecks ?? []) {
    if (!checkPathExists(response, requiredCheck)) {
      errors.push(`missing required check: ${requiredCheck}`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      data: null,
      errors,
    };
  }

  return {
    success: true,
    data: response,
    errors: [],
  };
}
