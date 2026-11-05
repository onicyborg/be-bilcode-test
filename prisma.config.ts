import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { seed: 'node -r ts-node/register scripts/seed-demo.ts' },
  datasource: { url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL },
});
