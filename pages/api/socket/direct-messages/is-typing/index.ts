import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { NextApiResponseServerIO } from '@/types';
import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';
import { z } from 'zod';

const querySchema = z.object({
  chatId: z.string().nonempty().trim(),
  memberId: z.string().nonempty().trim(),
});

const bodySchema = z.object({
  isTyping: z.boolean(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    await NextCors(req, res, {
      // Options
      methods: ['POST'],
      origin: '*',
      optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
    });

    const profile = await currentProfile(req);

    if (!profile) {
      throw new UnauthorizedError();
    }

    const queryResponse = querySchema.safeParse(req.query);

    if (!queryResponse.success) {
      throw new ValidationError(queryResponse.error.errors);
    }

    const { chatId, memberId } = queryResponse.data;

    const bodyResponse = bodySchema.safeParse(req.body);

    if (!bodyResponse.success) {
      throw new ValidationError(bodyResponse.error.errors);
    }

    const { isTyping } = bodyResponse.data;

    res?.socket?.server?.io?.emit(
      `chat:${chatId}:istyping:${memberId}`,
      isTyping
    );

    res.end();
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[IS_TYPING]');
  }
}
