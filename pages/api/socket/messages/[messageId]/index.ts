import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';

import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { MemberRole } from '@prisma/client';
import Cryptr from 'cryptr';
import { z } from 'zod';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { NotFoundError } from '@/errors/not-found-error';
import { apiErrorHandler } from '@/lib/api-error-handler';

const querySchema = z.object({
  serverId: z.string().nonempty(),
  channelId: z.string().nonempty(),
  messageId: z.string().nonempty(),
});

const bodySchema = z.object({
  content: z.string().nonempty(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  await NextCors(req, res, {
    // Options
    methods: ['PATCH', 'DELETE'],
    origin: '*',
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });
  try {
    if (req.method !== 'DELETE' && req.method !== 'PATCH') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const profile = await currentProfile(req);

    if (!profile) {
      throw new UnauthorizedError();
    }

    const queryResponse = querySchema.safeParse(req.query);

    if (!queryResponse.success) {
      throw new ValidationError(queryResponse.error.errors);
    }

    const { serverId, channelId, messageId } = queryResponse.data;

    const [serverResponse, messageResponse] = await Promise.allSettled([
      db.server.findFirst({
        where: {
          id: serverId,
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
      db.message.findFirst({
        where: {
          id: messageId,
          channelId: channelId,
        },
        include: {
          member: {
            include: {
              profile: true,
            },
          },
        },
      }),
    ]);

    if (serverResponse.status === 'rejected' || !serverResponse.value) {
      throw new NotFoundError('Server not found');
    }

    if (messageResponse.status === 'rejected' || !messageResponse.value) {
      throw new NotFoundError('Message not found');
    }

    const server = serverResponse.value;
    let message = messageResponse.value;

    const member = server.members.find(
      (member) => member.profileId === profile.id
    );

    if (!member) {
      throw new NotFoundError('Member not found');
    }

    const isMessageOwner = message.memberId === member.id;
    const isAdmin = member.role === MemberRole.ADMIN;
    const isModerator = member.role === MemberRole.MODERATOR;
    const canModify = isMessageOwner || isAdmin || isModerator;

    if (!canModify) {
      throw new UnauthorizedError();
    }

    if (req.method === 'DELETE') {
      message = await db.message.update({
        where: {
          id: messageId as string,
        },
        data: {
          fileUrl: null,
          content: 'This message has been deleted',
          deleted: true,
        },
        include: {
          member: {
            include: {
              profile: true,
            },
          },
        },
      });
    }

    if (req.method === 'PATCH') {
      if (!isMessageOwner) {
        throw new UnauthorizedError();
      }

      const bodyResponse = bodySchema.safeParse(req.body);

      if (!bodyResponse.success) {
        throw new ValidationError(bodyResponse.error.errors);
      }

      const { content } = bodyResponse.data;

      const cryptr = new Cryptr(process.env.CRYPTR_SECRET_KEY ?? '', {
        // @ts-ignore
        encoding: 'base64',
        pbkdf2Iterations: 10000,
        saltLength: 10,
      });
      const encryptedContent = cryptr.encrypt(content);

      message = await db.message.update({
        where: {
          id: messageId,
          channelId: channelId,
        },
        data: {
          content: encryptedContent,
        },
        include: {
          member: {
            include: {
              profile: true,
            },
          },
        },
      });

      message.content = content;
    }

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    const updateKey = `chat:${channelId}:messages:update`;

    res?.socket?.server?.io?.emit(updateKey, message);

    return res.status(200).json(message);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[MESSAGE_ID]');
  }
}
