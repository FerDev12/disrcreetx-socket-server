import { InternalServerError } from '@/errors/internal-server-error';
import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO, ServerSocketEvents } from '@/types';
import { MemberRole } from '@prisma/client';
import { NextApiRequest } from 'next';
import NextCors from 'nextjs-cors';
import { z } from 'zod';

const querySchema = z.object({
  serverId: z.string().uuid().nonempty(),
  memberId: z.string().uuid().nonempty(),
});

const bodySchema = z.object({
  role: z.enum([MemberRole.GUEST, MemberRole.MODERATOR]),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    await NextCors(req, res, {
      origin: '*',
      methods: ['PATCH', 'DELETE'],
      optionsSuccessStatus: 200,
    });

    const profile = await currentProfile(req);

    if (!profile) {
      throw new UnauthorizedError();
    }

    const queryResponse = querySchema.safeParse(req.query);

    if (!queryResponse.success) {
      throw new ValidationError(queryResponse.error.errors);
    }

    const { serverId, memberId } = queryResponse.data;

    if (req.method === 'PATCH') {
      const bodyResponse = bodySchema.safeParse(req.body);

      if (!bodyResponse.success) {
        throw new ValidationError(bodyResponse.error.errors);
      }

      const { role } = bodyResponse.data;

      const server = await db.server.update({
        where: {
          id: serverId,
          members: {
            some: {
              profileId: profile.id,
              role: {
                in: ['MODERATOR', 'ADMIN'],
              },
            },
          },
        },
        data: {
          members: {
            update: {
              where: {
                id: memberId,
                serverId,
              },
              data: {
                role,
              },
            },
          },
        },
        include: {
          members: {
            include: {
              profile: true,
            },
            orderBy: {
              role: 'asc',
            },
          },
        },
      });

      const memberUpdateKey = `server:${serverId}`;
      res.socket?.server?.io?.emit(memberUpdateKey, {
        typ: ServerSocketEvents.MEMBER_UPDATED,
        data: server.members.find((member) => member.id === memberId),
      });

      return res.status(200).json(server);
    }

    if (req.method === 'DELETE') {
      const member = await db.member.delete({
        where: {
          id: memberId,
          server: {
            id: serverId,
            members: {
              some: {
                profileId: profile.id,
                role: {
                  in: ['MODERATOR', 'ADMIN'],
                },
              },
            },
          },
        },
        include: {
          server: {
            include: {
              members: {
                include: {
                  profile: {
                    select: {
                      id: true,
                      name: true,
                      imageUrl: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!member) {
        throw new NotFoundError('Member not found');
      }

      const memberDeletedKey = `server:${serverId}`;
      res.socket?.server?.io?.emit(memberDeletedKey, {
        type: ServerSocketEvents.MEMBER_DELETED,
        data: member,
      });

      return res.status(200).json(member.server);
    }

    throw new InternalServerError();
  } catch (err: any) {
    return apiErrorHandler(
      err,
      req,
      res,
      `[MESSAGE_ID_${req.method?.toUpperCase()}]`
    );
  }
}
