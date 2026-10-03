import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Validación ligera de los railway.json (el esquema oficial está en railway.schema.json).
const services = ['api', 'analytics', 'web'] as const;
type RailwayConfig = {
  build: { builder: string; dockerfilePath: string };
  deploy: {
    startCommand?: string;
    healthcheckPath: string;
    restartPolicyType: string;
    restartPolicyMaxRetries: number;
    preDeployCommand?: string[];
  };
};
const parse = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as RailwayConfig;
const read = (service: string) => parse(`apps/${service}/railway.json`);

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
    expect(read('api').deploy.preDeployCommand).toEqual(['node dist/migrate.js auto']);
    expect(read('analytics').deploy.preDeployCommand).toBeUndefined();
    expect(read('web').deploy.preDeployCommand).toBeUndefined();
  });

  it('analytics-worker (006): imagen de analytics, su propio comando y healthcheck', () => {
    const worker = parse('apps/analytics/railway.worker.json');
    expect(worker.build).toEqual(read('analytics').build);
    expect(worker.deploy.startCommand).toBe('python -m analytics.worker');
    expect(worker.deploy.healthcheckPath).toBe('/health');
    expect(worker.deploy.restartPolicyType).toBe('ON_FAILURE');
    expect(worker.deploy.restartPolicyMaxRetries).toBe(3);
    expect(worker.deploy.preDeployCommand).toBeUndefined();
  });

  it('analysis-worker (007): imagen propia de minería, su comando y healthcheck', () => {
    const worker = parse('apps/analytics/railway.mining.json');
    expect(worker.build).toEqual({
      builder: 'DOCKERFILE',
      dockerfilePath: 'apps/analytics/Dockerfile.mining',
    });
    expect(readFileSync(worker.build.dockerfilePath, 'utf8')).toContain(
      'CMD ["python", "-m", "analytics.mining.worker"]',
    );
    expect(worker.deploy.startCommand).toBe('python -m analytics.mining.worker');
    expect(worker.deploy.healthcheckPath).toBe('/health');
    expect(worker.deploy.restartPolicyType).toBe('ON_FAILURE');
    expect(worker.deploy.restartPolicyMaxRetries).toBe(3);
    expect(worker.deploy.preDeployCommand).toBeUndefined();
  });

  it('deploy.yml despliega los dos workers con los demás servicios', () => {
    expect(readFileSync('.github/workflows/deploy.yml', 'utf8')).toContain(
      'for service in analytics analytics-worker analysis-worker api web; do',
    );
  });
});
