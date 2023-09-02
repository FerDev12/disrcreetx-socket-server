// import { createApiHandler } from '@/lib/api-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { MemberRole } from '@prisma/client';
import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';

// const handler = createApiHandler<NextApiRequest, NextApiResponseServerIO>();

export async function handler(
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
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { directMessageId, conversationId } = req.query;

    if (!directMessageId) {
      return res.status(400).json({ error: 'Direct message Id missing' });
    }

    if (!conversationId) {
      return res.status(400).json({ error: 'Conversation Id missing' });
    }

    const [conversationResponse, directMessageResponse] =
      await Promise.allSettled([
        db.conversation.findFirst({
          where: {
            id: conversationId as string,
            OR: [
              {
                memberOne: {
                  profileId: profile.id,
                },
              },
              {
                memberTwo: {
                  profileId: profile.id,
                },
              },
            ],
          },
          include: {
            memberOne: {
              include: {
                profile: true,
              },
            },
            memberTwo: {
              include: {
                profile: true,
              },
            },
          },
        }),
        db.directMessage.findFirst({
          where: {
            id: directMessageId as string,
            conversationId: conversationId as string,
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

    if (conversationResponse.status === 'rejected') {
      return res.status(400).json({ error: 'Conversation request failed' });
    }

    if (directMessageResponse.status === 'rejected') {
      return res.status(400).json({ error: 'Direct message request failed' });
    }

    const conversation = conversationResponse.value;
    let directMessage = directMessageResponse.value;

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!directMessage || directMessage.deleted) {
      return res.status(404).json({ error: 'Direct message not found' });
    }

    const member =
      conversation.memberOne.profileId === profile.id
        ? conversation.memberOne
        : conversation.memberTwo;

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const isMessageOwner = directMessage.memberId === member.id;
    const isAdmin = member.role === MemberRole.ADMIN;
    const isModerator = member.role === MemberRole.MODERATOR;
    const canModify = isMessageOwner || isAdmin || isModerator;

    if (!canModify) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'DELETE') {
      directMessage = await db.directMessage.update({
        where: {
          id: directMessageId as string,
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
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { content } = req.body;

      directMessage = await db.directMessage.update({
        where: {
          id: directMessageId as string,
        },
        data: {
          content,
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

    const updateKey = `chat:${conversationId}:messages:update`;

    res?.socket?.server?.io?.emit(updateKey, directMessage);

    return res.status(200).json(directMessage);
  } catch (err: any) {
    console.error('[DIRECT_MESSAGE_ID_ERROR]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

export default handler;
