import { BaseError, SerializedError } from './base-error';

export class UnauthorizedError extends BaseError {
  status = 401;
  name = 'Unauthorized';

  constructor(message?: string) {
    super(message);

    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }

  serializedErrors(): { errors: SerializedError[] } {
    return {
      errors: [
        {
          error: this.name,
          message: this.message,
        },
      ],
    };
  }
}
