import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';

import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { MemberRole } from '@prisma/client';
import Cryptr from 'cryptr';

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
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { messageId, serverId, channelId } = req.query;

    if (!serverId) {
      return res.status(400).json({ error: 'Server Id missing' });
    }

    if (!channelId) {
      return res.status(400).json({ error: 'Channel Id missing' });
    }

    if (!messageId) {
      return res.status(400).json({ error: 'Message Id missing' });
    }

    const [serverResponse, channelResponse, messageResponse] =
      await Promise.allSettled([
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
        db.message.findFirst({
          where: {
            id: messageId as string,
            channelId: channelId as string,
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

    if (serverResponse.status === 'rejected') {
      return res.status(400).json({ error: 'Fetch server request failed' });
    }

    if (channelResponse.status === 'rejected') {
      return res.status(400).json({ error: 'Fetch channel request failed' });
    }

    if (messageResponse.status === 'rejected') {
      return res.status(400).json({ error: 'Fetch message request failed' });
    }

    const server = serverResponse.value;
    const channel = channelResponse.value;
    let message = messageResponse.value;

    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    if (!message || message.deleted) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const member = server.members.find(
      (member) => member.profileId === profile.id
    );

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const isMessageOwner = message.memberId === member.id;
    const isAdmin = member.role === MemberRole.ADMIN;
    const isModerator = member.role === MemberRole.MODERATOR;
    const canModify = isMessageOwner || isAdmin || isModerator;

    if (!canModify) {
      return res.status(401).json({ error: 'Unauthorized' });
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
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { content } = req.body as { content: string };

      const cryptr = new Cryptr(process.env.CRYPTR_SECRET_KEY ?? '');
      const encryptedContent = cryptr.encrypt(content);

      message = await db.message.update({
        where: {
          id: messageId as string,
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
      return res.status(400).json({ error: 'Something went wrong' });
    }

    const updateKey = `chat:${channelId}:messages:update`;

    res?.socket?.server?.io?.emit(updateKey, message);

    return res.status(200).json(message);
  } catch (err: any) {
    console.error('[MESSAGE_ID_ERROR]', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
