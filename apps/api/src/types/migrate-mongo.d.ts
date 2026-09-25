// Tipos mínimos de la API programática de migrate-mongo (el paquete no publica tipos).
declare module 'migrate-mongo' {
  import type { Db, MongoClient } from 'mongodb';

  export type MigrateMongoConfig = {
    mongodb: { url: string; databaseName: string; options?: Record<string, unknown> };
    migrationsDir: string;
    changelogCollectionName: string;
    lockCollectionName?: string;
    lockTtl?: number;
    migrationFileExtension?: string;
    useFileHash?: boolean;
    moduleSystem?: 'commonjs' | 'esm';
  };

  export type MigrationStatus = {
    fileName: string;
    appliedAt: string | Date;
    migrationBlock?: number;
  };

  export const config: { set(content: MigrateMongoConfig): void };
  export const database: { connect(): Promise<{ db: Db; client: MongoClient }> };
  export function up(db: Db, client: MongoClient): Promise<string[]>;
  export function down(db: Db, client: MongoClient): Promise<string[]>;
  export function status(db: Db): Promise<MigrationStatus[]>;
}
