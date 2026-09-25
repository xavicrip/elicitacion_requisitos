import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Validación ligera de los railway.json (el esquema oficial está en railway.schema.json).
const services = ['api', 'analytics', 'web'] as const;
const read = (service: string) =>
  JSON.parse(readFileSync(`apps/${service}/railway.json`, 'utf8')) as {
    build: { builder: string; dockerfilePath: string };
    deploy: {
      healthcheckPath: string;
      restartPolicyType: string;
      restartPolicyMaxRetries: number;
      preDeployCommand?: string[];
    };
  };

describe('railway.json', () => {
  it.each(services)('%s: Dockerfile propio, healthcheck y reinicio ON_FAILURE ×3', (service) => {
    const config = read(service);
    expect(config.build.builder).toBe('DOCKERFILE');
    expect(config.build.dockerfilePath).toBe(`apps/${service}/Dockerfile`);
    expect(config.deploy.healthcheckPath).toBe('/health');
    expect(config.deploy.restartPolicyType).toBe('ON_FAILURE');
    expect(config.deploy.restartPolicyMaxRetries).toBe(3);
  });

  it.each(services)(
    '%s: sin watchPatterns (el CI decide qué se despliega; Railway omitiría commits)',
    (service) => {
      expect(read(service).build).not.toHaveProperty('watchPatterns');
    },
  );

  it('solo api ejecuta migraciones antes de desplegar (S1: sin exponer MongoDB)', () => {
    expect(read('api').deploy.preDeployCommand).toEqual(['node dist/migrate.js up']);
    expect(read('analytics').deploy.preDeployCommand).toBeUndefined();
    expect(read('web').deploy.preDeployCommand).toBeUndefined();
  });
});
