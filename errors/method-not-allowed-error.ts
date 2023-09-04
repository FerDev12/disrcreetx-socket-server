import { BaseError, SerializedError } from './base-error';

export class MethodNotAllowedError extends BaseError {
  status = 404;
  name = 'Method Not Allwed';
  message = '';

  constructor(message?: string, name?: string) {
    super(message);

    if (name) {
      this.name = name;
    }

    Object.setPrototypeOf(this, MethodNotAllowedError.prototype);
  }

  serializedErrors(): { errors: SerializedError[] } {
    return {
      errors: [
        {
          error: this.name,
          // message: this.message,
        },
      ],
    };
  }
}
