/**
 * Application error types and the standard error envelope.
 * Controllers throw ApiError; the central error middleware serializes it.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_EXISTS'
  | 'WEAK_PASSWORD'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_REQUIRED'
  | 'TOKEN_INVALID'
  | 'GOOGLE_NOT_CONFIGURED'
  | 'GOOGLE_VERIFY_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown): ApiError {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(code: ErrorCode, message: string): ApiError {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'Forbidden'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, 'CONFLICT', message);
  }

  static serviceUnavailable(code: ErrorCode, message: string): ApiError {
    return new ApiError(503, code, message);
  }
}
