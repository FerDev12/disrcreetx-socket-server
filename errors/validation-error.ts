import { ZodIssue } from 'zod';
import { BaseError, SerializedError } from './base-error';

export class ValidationError extends BaseError {
  status = 400;
  name = 'Validation';
  message = 'Please check your request values';

  errors: { path: (string | number)[]; message: string }[];
  constructor(errors: ZodIssue[], message?: string) {
    super(message);

    this.errors = errors.map((err) => ({
      path: err.path,
      message: err.message,
    }));

    Object.setPrototypeOf(this, ValidationError.prototype);
  }

  serializedErrors(): { errors: SerializedError[] } {
    return {
      errors: [
        {
          error: this.name,
          message: this.message,
          validationErrors: this.errors,
        },
      ],
    };
  }
}
