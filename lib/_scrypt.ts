import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export const _scrypt = {
  generateKey(size = 32, format: BufferEncoding = 'base64'): string {
    const buffer = randomBytes(size);
    return buffer.toString(format);
  },
  generateHash(key: string) {
    const salt = randomBytes(16).toString('hex');
    const buffer = scryptSync(key, salt, 64) as Buffer;
    return `${buffer.toString('hex')}.${salt}`;
  },
  compare(storedKey: string, suppliedKey: string) {
    const [hashedPassowrd, salt] = storedKey.split('.');
    const buffer = scryptSync(suppliedKey, salt, 64) as Buffer;
    return timingSafeEqual(Buffer.from(hashedPassowrd, 'hex'), buffer);
  },
};
