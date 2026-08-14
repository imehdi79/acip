import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 stopped reading .env on its own, so nothing below (DATABASE_URL
// included) exists until we load it ourselves. Must come before `env(...)`.
config();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    // tsx, because seed.ts is TypeScript and node can't run it directly
    seed: 'tsx prisma/seed.ts',
  },
});
