import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

// Prisma 7 ships no query engine of its own — the pg driver adapter *is* the
// connection, and it owns a real pool.
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

// `next dev` re-evaluates modules on every hot reload. Without parking the
// client on globalThis, each reload leaks another pool and Postgres refuses
// connections long before anything points at the reload as the cause.
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Re-exported so consumers get the row type without knowing where the client
// is generated to.
export type { User } from '@/generated/prisma/client';
