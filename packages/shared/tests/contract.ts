import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

type SchemaObject = {
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  maxItems?: number;
  items?: SchemaObject;
  required?: string[];
  properties?: Record<string, SchemaObject>;
};

const CONTRACTS = {
  '002': '002-auth-proyectos/contracts/auth-projects.openapi.yaml',
  '003': '003-diagramas-canvas/contracts/diagrams.openapi.yaml',
  '004': '004-detalles-requisitos/contracts/details.openapi.yaml',
} as const;

const cache = new Map<string, Record<string, SchemaObject>>();

function schemasOf(feature: keyof typeof CONTRACTS) {
  let schemas = cache.get(feature);
  if (!schemas) {
    const path = fileURLToPath(new URL(`../../../specs/${CONTRACTS[feature]}`, import.meta.url));
    schemas = (
      parse(readFileSync(path, 'utf8')) as {
        components: { schemas: Record<string, SchemaObject> };
      }
    ).components.schemas;
    cache.set(feature, schemas);
  }
  return schemas;
}

/** Esquema de `components.schemas` del contrato OpenAPI de una feature (002 por defecto). */
export function contractSchema(
  name: string,
  feature: keyof typeof CONTRACTS = '002',
): SchemaObject {
  const schema = schemasOf(feature)[name];
  if (!schema) throw new Error(`El contrato de la ${feature} no define el esquema ${name}`);
  return schema;
}
