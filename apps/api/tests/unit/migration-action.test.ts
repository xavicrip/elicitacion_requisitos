import { describe, expect, it } from 'vitest';
import { backupKey, s3SettingsFromEnv } from '../../src/db/backup';
import { parseMigrationAction } from '../../src/db/migrations';

describe('MIGRATION_ACTION', () => {
  it.each([undefined, '', '  ', 'up'])('%j aplica las migraciones pendientes', (raw) => {
    expect(parseMigrationAction(raw)).toEqual({ kind: 'up' });
  });

  it('down:<archivo> revierte desde esa migración', () => {
    expect(parseMigrationAction('down:20260925000000-init-indexes.js')).toEqual({
      kind: 'down',
      from: '20260925000000-init-indexes.js',
    });
  });

  it('restore:<clave> y restore:latest restauran un respaldo', () => {
    expect(parseMigrationAction('restore:mongo-backups/a:b.ndjson.gz')).toEqual({
      kind: 'restore',
      key: 'mongo-backups/a:b.ndjson.gz',
    });
    expect(parseMigrationAction('restore:latest')).toEqual({ kind: 'restore', key: 'latest' });
  });

  it.each(['down', 'down:', 'down:init.js', 'restore:', 'drop', 'up:x'])('rechaza %j', (raw) => {
    expect(() => parseMigrationAction(raw)).toThrow(/MIGRATION_ACTION inválida/);
  });
});

describe('respaldos', () => {
  it('la clave empieza por un timestamp ordenable e incluye la versión saneada', () => {
    const key = backupKey('v0.1.1-2-gabc/x', new Date('2026-09-29T10:11:12.345Z'));
    expect(key).toBe('mongo-backups/2026-09-29T10-11-12-345Z-v0.1.1-2-gabc_x.ndjson.gz');
  });

  it('la configuración del bucket nombra las variables que faltan', () => {
    expect(s3SettingsFromEnv({ BACKUP_S3_BUCKET: 'b' })).toEqual({
      missing: ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY'],
    });
  });

  it('la configuración completa usa region auto y virtual-hosted por defecto', () => {
    expect(
      s3SettingsFromEnv({
        BACKUP_S3_ENDPOINT: 'https://s3.example',
        BACKUP_S3_BUCKET: 'b',
        BACKUP_S3_ACCESS_KEY_ID: 'id',
        BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toEqual({
      settings: {
        endpoint: 'https://s3.example',
        bucket: 'b',
        region: 'auto',
        accessKeyId: 'id',
        secretAccessKey: 'secret',
        forcePathStyle: false,
      },
    });
  });
});
