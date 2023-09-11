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

const querySchema = z.object({
  serverId: z.string().nonempty(),
  channelId: z.string().nonempty(),
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
      return res.status(401).json({ error: 'Unauthorized' });
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

    const { serverId, channelId } = queryResponse.value.data;
    const { content, fileUrl } = bodyResponse.value.data;

    const [serverResponse, channelResponse] = await Promise.allSettled([
      db.server.findFirst({
        where: {
          id: serverId as string,
          members: {
            some: {
              profileId: profile.id,
            },
          },
        },
        include: {
          members: true,
        },
      }),
      db.channel.findFirst({
        where: {
          id: channelId as string,
          serverId: serverId as string,
        },
      }),
    ]);

    if (serverResponse.status === 'rejected') {
      throw new NotFoundError('Server not found');
    }

    if (channelResponse.status === 'rejected') {
      throw new NotFoundError('Channel not found');
    }

    const server = serverResponse.value;
    const channel = channelResponse.value;

    if (!server) {
      throw new NotFoundError('Server not found');
    }

    if (!channel) {
      throw new NotFoundError('Channel not found');
    }

    const member = server.members.find(
      (member) => member.profileId === profile.id
    );

    if (!member) {
      throw new NotFoundError('Member not found');
    }

    // ENCRYPT CONTENTS
    const cryptr = new Cryptr(process.env.CRYPTR_SECRET_KEY ?? '');
    const encryptedContent = cryptr.encrypt(content);
    let encryptedFileUrl: null | string = null;
    if (fileUrl) {
      encryptedFileUrl = cryptr.encrypt(fileUrl);
    }

    const message = await db.message.create({
      data: {
        content: encryptedContent,
        fileUrl: encryptedFileUrl,
        channelId: channelId as string,
        memberId: member.id,
        createdAt: date,
        updatedAt: date,
      },
      include: {
        member: {
          include: {
            profile: true,
          },
        },
      },
    });

    if (!message) {
      throw new BadRequestError('Something went wrong!');
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
