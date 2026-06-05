import { NextResponse } from "next/server";

type ErrorDetails = Record<string, unknown> | string | undefined;

type ClientErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "request_failed"
  | "unexpected_error";

type ClientErrorPayload = {
  error: {
    code: ClientErrorCode;
    message: string;
    details?: ErrorDetails;
  };
};

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Please try again.";
const REQUEST_FAILED_MESSAGE = "The request could not be completed.";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: ErrorDetails;

  constructor(status: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ApiErrorLike = {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetails;
};

function isApiErrorLike(error: unknown): error is ApiErrorLike {
  if (!(error instanceof ApiError) && (typeof error !== "object" || error === null)) {
    return false;
  }

  const candidate = error as Partial<ApiErrorLike>;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

function normalizeErrorCode(error: ApiErrorLike): ClientErrorCode {
  switch (error.code) {
    case "VALIDATION_ERROR":
    case "validation_failed":
      return "validation_failed";
    case "AUTHENTICATION_REQUIRED":
    case "unauthorized":
      return "unauthorized";
    case "ORG_ROLE_REQUIRED":
    case "ORG_MEMBERSHIP_REQUIRED":
    case "forbidden":
      return "forbidden";
    case "RESOURCE_NOT_FOUND":
    case "APP_NOT_FOUND":
    case "APP_ENVIRONMENT_NOT_FOUND":
    case "MONITOR_NOT_FOUND":
    case "not_found":
      return "not_found";
    case "RESOURCE_CONFLICT":
    case "conflict":
      return "conflict";
    case "INVALID_RELATION":
    case "DATABASE_ERROR":
    case "request_failed":
      return "request_failed";
    default:
      if (error.status === 401) {
        return "unauthorized";
      }
      if (error.status === 403) {
        return "forbidden";
      }
      if (error.status === 404) {
        return "not_found";
      }
      if (error.status === 409) {
        return "conflict";
      }
      return "unexpected_error";
  }
}

function getSafeClientMessage(error: ApiErrorLike, clientCode: ClientErrorCode) {
  switch (clientCode) {
    case "validation_failed":
      return "Request validation failed.";
    case "unauthorized":
      return "Authentication required.";
    case "forbidden":
      return "You do not have permission to perform this action.";
    case "not_found":
      return "The requested resource was not found.";
    case "conflict":
      return "A record with these details already exists.";
    case "request_failed":
      return REQUEST_FAILED_MESSAGE;
    case "unexpected_error":
    default:
      return UNEXPECTED_ERROR_MESSAGE;
  }
}

function toClientErrorPayload(error: ApiErrorLike): ClientErrorPayload {
  const clientCode = normalizeErrorCode(error);
  const payload: ClientErrorPayload = {
    error: {
      code: clientCode,
      message: getSafeClientMessage(error, clientCode),
    },
  };

  if (clientCode === "validation_failed" && error.details) {
    payload.error.details = error.details;
  }

  return payload;
}

export function createErrorResponse(error: unknown) {
  if (isApiErrorLike(error)) {
    return NextResponse.json(toClientErrorPayload(error), { status: error.status });
  }

  if (error instanceof Error) {
    console.error("Unhandled API error", error);
  } else {
    console.error("Unhandled API error", { error });
  }

  return NextResponse.json(
    {
      error: {
        code: "unexpected_error",
        message: UNEXPECTED_ERROR_MESSAGE,
      },
    },
    { status: 500 },
  );
}

export function mapPostgresError(error: { code?: string; message: string }) {
  switch (error.code) {
    case "23505":
      return new ApiError(409, "conflict", "A record with these details already exists.");
    case "23503":
      return new ApiError(400, "request_failed", "The selected related record is invalid.");
    case "42501":
      return new ApiError(403, "forbidden", "You do not have permission to perform this action.");
    default:
      return new ApiError(500, "request_failed", REQUEST_FAILED_MESSAGE);
  }
}

export function getActionErrorRedirectValue(error: unknown): ClientErrorCode {
  if (isApiErrorLike(error)) {
    return normalizeErrorCode(error);
  }

  return "unexpected_error";
}

export function getActionErrorMessage(errorCode: string | null | undefined) {
  switch (errorCode) {
    case "validation_failed":
      return "The submitted details are invalid.";
    case "unauthorized":
      return "Sign in again to continue.";
    case "forbidden":
      return "You do not have permission to perform this action.";
    case "not_found":
      return "The requested record could not be found.";
    case "conflict":
      return "A record with these details already exists.";
    case "request_failed":
      return REQUEST_FAILED_MESSAGE;
    case "unexpected_error":
      return UNEXPECTED_ERROR_MESSAGE;
    default:
      return null;
  }
}
