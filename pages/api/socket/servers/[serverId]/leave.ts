import { NotFoundError } from '@/errors/not-found-error';
import { UnauthorizedError } from '@/errors/unauthorized-error';
import { ValidationError } from '@/errors/validation-error';
import { apiErrorHandler } from '@/lib/api-error-handler';
import { currentProfile } from '@/lib/current-profile';
import { db } from '@/lib/db';
import { NextApiResponseServerIO } from '@/types';
import { NextApiRequest } from 'next';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const querySchema = z.object({
  serverId: z.string().uuid().nonempty(),
});

export async function handler(
  req: NextApiRequest,
  res: NextApiResponseServerIO
) {
  try {
    const profile = await currentProfile(req);

    if (!profile) {
      throw new UnauthorizedError();
    }

    const queryResponse = querySchema.safeParse(req.query);

    if (!queryResponse.success) {
      throw new ValidationError(queryResponse.error.errors);
    }

    const { serverId } = queryResponse.data;

    const server = await db.server.update({
      where: {
        id: serverId,
        members: {
          some: {
            profileId: profile.id,
          },
        },
      },
      data: {
        members: {
          deleteMany: {
            profileId: profile.id,
          },
        },
      },
      include: {
        members: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!server) {
      throw new NotFoundError('Server not found');
    }

    const leftServerKey = `server:${serverId}:member:leave`;
    res?.socket?.server?.io?.emit(leftServerKey);

    return NextResponse.json(server);
  } catch (err: any) {
    return apiErrorHandler(err, req, res, '[SERVER_LEAVE] ');
  }
}
