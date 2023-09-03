export interface SerializedError {
  error: string;
  message?: string;
  validationErrors?: { path: (string | number)[]; message: string }[];
  // issues?: ValidationIssue[];
}

export abstract class BaseError extends Error {
  abstract name: string;
  abstract status: number;

  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, BaseError.prototype);
  }

  abstract serializedErrors(): { errors: SerializedError[] };
}
