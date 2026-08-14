import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// CONTRACT — this must stay byte-for-byte identical to the hashing in
// prisma/seed.ts, or the seeded admin can never sign in.
//
//   format : `scrypt$<saltHex>$<keyHex>`
//   salt   : 16 random bytes, hex-encoded (32 hex chars)
//   scrypt : N=16384, r=8, p=1, keylen=64
//
// Note the salt is handed to scrypt as its *hex string*, not as the raw 16
// bytes. That is what the seed does, and both sides must derive the same way.
const SCHEME = 'scrypt';
const SCRYPT_PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// The sync variant would block the event loop for the whole ~100ms derivation,
// and every sign-in attempt runs one. The arrow is here to pin scrypt's
// options overload — promisify(scrypt) on its own resolves to the 3-argument
// one and loses both the params and the return type.
const scryptAsync = promisify(
  (
    password: string,
    salt: string,
    keylen: number,
    options: ScryptOptions,
    callback: (error: Error | null, derivedKey: Buffer) => void,
  ) => scrypt(password, salt, keylen, options, callback),
);

export async function hashPassword(plain: string): Promise<string> {
  const saltHex = randomBytes(SALT_BYTES).toString('hex');
  const key = await scryptAsync(plain, saltHex, KEY_LENGTH, SCRYPT_PARAMS);

  return `${SCHEME}$${saltHex}$${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== SCHEME) {
    return false;
  }

  const [, saltHex, keyHex] = parts;

  // Buffer.from(..., 'hex') truncates at the first bad character instead of
  // throwing, and timingSafeEqual throws outright on a length mismatch — so
  // the length is checked here rather than left to blow up below.
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEY_LENGTH || saltHex.length !== SALT_BYTES * 2) {
    return false;
  }

  const actual = await scryptAsync(plain, saltHex, KEY_LENGTH, SCRYPT_PARAMS);

  return timingSafeEqual(actual, expected);
}
