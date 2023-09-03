import { BaseError, SerializedError } from './base-error';

export class InternalServerError extends BaseError {
  status = 500;
  name = 'Internal Server Error';
  message = 'Something went wrong';

  constructor(message?: string, name?: string) {
    super(message);

    if (name) {
      this.name = name;
    }

    Object.setPrototypeOf(this, InternalServerError.prototype);
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
