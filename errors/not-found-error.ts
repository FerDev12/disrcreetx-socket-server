import { BaseError, SerializedError } from './base-error';

export class NotFoundError extends BaseError {
  status = 404;
  name = 'Not Found';
  message = 'Asset not found';

  constructor(message?: string, name?: string) {
    super(message);

    if (name) {
      this.name = name;
    }

    Object.setPrototypeOf(this, NotFoundError.prototype);
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
