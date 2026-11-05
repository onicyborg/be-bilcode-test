import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { Global, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

@Injectable()
export class Database implements OnApplicationShutdown {
  readonly pool = new Pool({ connectionString: required('DATABASE_URL') });

  readonly prisma = new PrismaClient({ adapter: new PrismaPg(this.pool) });

  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown() {
    await this.prisma.$disconnect();
    await this.pool.end();
  }
}

@Global()
@Module({ providers: [Database], exports: [Database] })
export class DatabaseModule {}
