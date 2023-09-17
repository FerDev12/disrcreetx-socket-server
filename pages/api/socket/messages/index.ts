import { NextApiRequest } from 'next';

import { NextApiResponseServerIO } from '@/types';
import NextCors from 'nextjs-cors';
import Cryptr from 'cryptr';
import { z } from 'zod';
import { BadRequestError } from '@/errors/bad-request-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NotFoundError } from '@/errors/not-found-error';
import { ValidationError } from '@/errors/validation-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';

const querySchema = z.object({
  serverId: z.string().uuid().nonempty(),
  channelId: z.string().uuid().nonempty(),
  memberId: z.string().uuid().nonempty(),
});

const bodySchema = z.object({
  content: z.string().nonempty(),
  fileUrl: z.string().url().nullish(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  await NextCors(req, res, {
    // Options
    methods: ['POST'],
    origin: '*',
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });

  try {
    const date = new Date();

    const profile = await currentProfile(req);

    if (!profile) {
      throw new UnauthorizedError();
    }

    const [queryResponse, bodyResponse] = await Promise.allSettled([
      querySchema.safeParseAsync(req.query),
      bodySchema.safeParseAsync(req.body),
    ]);

    if (queryResponse.status === 'rejected') {
      throw new BadRequestError('Failed to parse query');
    }

    if (!queryResponse.value.success) {
      throw new ValidationError(queryResponse.value.error.errors);
    }

    if (bodyResponse.status === 'rejected') {
      throw new BadRequestError('Failed to parse body');
    }

    if (!bodyResponse.value.success) {
      throw new ValidationError(bodyResponse.value.error.errors);
    }

    const { serverId, channelId, memberId } = queryResponse.value.data;
    const { content, fileUrl } = bodyResponse.value.data;

    const cryptr = new Cryptr(process.env.CRYPTR_SECRET_KEY ?? '', {
      // @ts-ignore
      encoding: 'base64',
      pbkdf2Iterations: 10000,
      saltLength: 10,
    });
    const encryptedContent = cryptr.encrypt(content);
    let encryptedFileUrl: null | string = null;
    if (fileUrl) {
      encryptedFileUrl = cryptr.encrypt(fileUrl);
    }

    const channel = await db.channel.update({
      where: {
        id: channelId,
        server: {
          id: serverId,
          members: {
            some: {
              id: memberId,
              profileId: profile.id,
            },
          },
        },
      },
      data: {
        messages: {
          create: {
            memberId,
            content: encryptedContent,
            fileUrl: encryptedFileUrl,
            createdAt: date,
            updatedAt: date,
          },
        },
      },
      select: {
        messages: {
          take: 1,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            member: true,
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundError('Channel not found');
    }

    const message = channel.messages?.at(0);

    if (!message) {
      throw new BadRequestError('Failed to create message');
    }

    message.content = content;
    message.fileUrl = fileUrl ?? null;

    const channelKey = `chat:${channelId}:messages`;

    res?.socket?.server?.io?.emit(channelKey, message);

    return res.status(201).json(message);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[MESSAGES_POST]');
  }
}
