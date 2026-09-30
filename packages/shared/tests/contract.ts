import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

type SchemaObject = {
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  properties?: Record<string, SchemaObject>;
};

const contractPath = fileURLToPath(
  new URL(
    '../../../specs/002-auth-proyectos/contracts/auth-projects.openapi.yaml',
    import.meta.url,
  ),
);

const contract = parse(readFileSync(contractPath, 'utf8')) as {
  components: { schemas: Record<string, SchemaObject> };
};

/** Esquema de `components.schemas` de contracts/auth-projects.openapi.yaml (feature 002). */
export function contractSchema(name: string): SchemaObject {
  const schema = contract.components.schemas[name];
  if (!schema) throw new Error(`El contrato no define el esquema ${name}`);
  return schema;
}
