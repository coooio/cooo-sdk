/** Structured SDK error type shared by validation and transport layers. */

export type CoooSdkErrorCode =
  | 'invalid_argument'
  | 'http_error'
  | 'rpc_error'
  | 'timeout'
  | 'state_validation'
  | 'aborted';

export type CoooSdkErrorDetails = Readonly<Record<string, unknown>>;

export class CoooSdkError extends Error {
  readonly code: CoooSdkErrorCode;
  readonly details: CoooSdkErrorDetails;
  readonly retryable: boolean;

  constructor(message: string, code: CoooSdkErrorCode, details: CoooSdkErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'CoooSdkError';
    this.code = code;
    this.details = Object.freeze({ ...details });
    this.retryable =
      code === 'timeout' ||
      (code === 'http_error' && typeof details.status === 'number' && [408, 425, 429, 500, 502, 503, 504].includes(details.status));
  }
}
