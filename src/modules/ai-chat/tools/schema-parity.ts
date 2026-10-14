import { z } from 'zod';
import { ChatTool } from './tool.types';

const list = (values: string[]) => `[${[...values].sort().join(',')}]`;

/**
 * Compares the hand-written JSON schema with the zod shape (property names and
 * required fields). Returns human-readable mismatches; empty means parity.
 */
export function jsonSchemaMismatches(tool: ChatTool): string[] {
  let schema: z.ZodTypeAny = tool.schema;
  // `.refine()` wraps the object in ZodEffects; compare against the inner shape.
  while (schema instanceof z.ZodEffects)
    schema = schema.innerType() as z.ZodTypeAny;
  if (!(schema instanceof z.ZodObject)) {
    return [`${tool.name}: schema must be a z.object`];
  }
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const zodKeys = Object.keys(shape);
  const zodRequired = zodKeys.filter((k) => !shape[k].isOptional());
  const jsonKeys = Object.keys(tool.parameters.properties);
  const jsonRequired = tool.parameters.required ?? [];

  const mismatches: string[] = [];
  if (list(zodKeys) !== list(jsonKeys)) {
    mismatches.push(
      `properties differ: zod=${list(zodKeys)} json=${list(jsonKeys)}`,
    );
  }
  if (list(zodRequired) !== list(jsonRequired)) {
    mismatches.push(
      `required differ: zod=${list(zodRequired)} json=${list(jsonRequired)}`,
    );
  }
  return mismatches;
}
