import { BaseError } from '@/errors/base-error';
import { InternalServerError } from '@/errors/internal-server-error';
import { NextApiRequest, NextApiResponse } from 'next';

export async function apiErrorHandler(
  error: unknown,
  _: NextApiRequest,
  res: NextApiResponse,
  loggerName?: string
) {
  if (error instanceof BaseError) {
    console.error(loggerName ?? '[OPERATIONAL ERROR]', error);
    return res.status(error.status).json(error.serializedErrors());
  }

  console.error((loggerName ?? '') + '[UNKNOW ERROR]', error);

  const internalError = new InternalServerError();
  return res
    .status(internalError.status)
    .json(internalError.serializedErrors());
}
