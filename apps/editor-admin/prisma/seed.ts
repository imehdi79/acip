import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client';

// Prisma 7 does not load .env for the seed process either.
config();

const EMAIL = 'admin@acip.local';
const PASSWORD = 'admin1234';

// ---------------------------------------------------------------------------
// Password hashing — CONTRACT. The sign-in path must verify with exactly this,
// or the seeded admin can never log in. Duplicated inline (not imported from
// src/) so seeding stays a plain script with no app-module resolution.
//
//   format : `scrypt$<saltHex>$<keyHex>`
//   salt   : 16 random bytes, hex-encoded
//   scrypt : N=16384, r=8, p=1, keylen=64
//   NOTE   : scrypt is fed the salt's *hex string*, not the raw bytes — the
//            verifier splits the stored value and passes field [1] straight in.
//
// Verify by re-deriving with the stored salt and comparing with
// `timingSafeEqual`, never `===`.
// ---------------------------------------------------------------------------
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

function hashPassword(password: string): string {
  const saltHex = randomBytes(16).toString('hex');
  const keyHex = scryptSync(
    password,
    saltHex,
    KEY_LENGTH,
    SCRYPT_PARAMS,
  ).toString('hex');

  return `scrypt$${saltHex}$${keyHex}`;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  // Upsert, so re-seeding a live database is a no-op rather than a crash.
  // The password is only (re)written on create — a seed run must never
  // silently reset an admin password someone has since changed.
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { name: 'Admin', role: 'admin' },
    create: {
      email: EMAIL,
      name: 'Admin',
      role: 'admin',
      passwordHash: hashPassword(PASSWORD),
    },
  });

  console.log(`\nSeeded admin user (${user.id})`);
  console.log(`  email    ${EMAIL}`);
  console.log(`  password ${PASSWORD}`);
  console.log('\nChange this password before anything faces the internet.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
