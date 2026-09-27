import { types } from 'node:util';
import { z } from 'zod';

export type JsonData = null | boolean | number | string | JsonData[] | { [key: string]: JsonData };
export const JSON_DATA_LIMITS = Object.freeze({ maximumDepth: 64, maximumNodes: 200_000, maximumBytes: 33_554_432 });
export class JsonDataError extends TypeError {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function reject(code: string): never { throw new JsonDataError(code); }

/** Copy JSON data without consulting constructors, invoking accessors or dropping own keys.
 * Ordinary objects are deliberate: the frozen canonical digest rejects null-prototype objects. */
export function cloneJsonData(value: unknown): JsonData {
  const ancestors = new Set<object>();
  let nodes = 0, bytes = 0;
  const charge = (count: number) => { bytes += count; if (bytes > JSON_DATA_LIMITS.maximumBytes) reject('json_byte_limit'); };
  const text = (s: string) => {
    if (s.length > JSON_DATA_LIMITS.maximumBytes) reject('json_byte_limit');
    charge(Buffer.byteLength(JSON.stringify(s), 'utf8'));
  };
  function copy(input: unknown, depth: number): JsonData {
    if (++nodes > JSON_DATA_LIMITS.maximumNodes) reject('json_node_limit');
    if (depth > JSON_DATA_LIMITS.maximumDepth) reject('json_depth_limit');
    if (input === null) { charge(4); return null; }
    if (typeof input === 'string') { text(input); return input; }
    if (typeof input === 'boolean') { charge(input ? 4 : 5); return input; }
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) reject('json_nonfinite_number');
      charge(JSON.stringify(input).length); return input;
    }
    if (typeof input !== 'object') reject('json_non_data_value');
    if (types.isProxy(input)) reject('json_proxy_not_supported');
    const object = input as object;
    if (ancestors.has(object)) reject('json_cycle');
    const array = Array.isArray(input);
    if (Object.getPrototypeOf(input) !== (array ? Array.prototype : Object.prototype)) reject('json_nonordinary_object');
    const keys = Reflect.ownKeys(input);
    if (keys.some(key => typeof key !== 'string')) reject('json_symbol_key');
    ancestors.add(object); charge(2);
    try {
      if (array) {
        const length = input.length;
        if (length > JSON_DATA_LIMITS.maximumNodes || keys.length !== length + 1) reject('json_array_shape');
        const result: JsonData[] = [];
        for (let i = 0; i < length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
          if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) reject('json_array_shape');
          if (i) charge(1);
          result.push(copy(descriptor.value, depth + 1));
        }
        return result;
      }
      const result: { [key: string]: JsonData } = {};
      for (const [index, key] of (keys as string[]).entries()) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!('value' in descriptor) || !descriptor.enumerable) reject('json_non_data_property');
        if (index) charge(1); text(key); charge(1);
        Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return result;
    } finally { ancestors.delete(object); }
  }
  return copy(value, 0);
}

export const JsonDataSchema = z.unknown().transform((value, ctx): JsonData => {
  try { return cloneJsonData(value); }
  catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof JsonDataError ? error.code : 'json_invalid_data' }); return z.NEVER; }
});

/** z.record in the pinned legacy dependency is not a key-preserving JSON dictionary. */
export function jsonRecord<S extends z.ZodType>(schema: S) {
  return JsonDataSchema.transform((value, ctx): Record<string, z.output<S>> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      ctx.addIssue({ code: 'custom', message: 'json_object_required' }); return z.NEVER;
    }
    const result: Record<string, z.output<S>> = {};
    for (const key of Object.keys(value)) {
      const parsed = schema.safeParse(value[key]);
      if (!parsed.success) { for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: [key, ...issue.path] }); continue; }
      Object.defineProperty(result, key, { value: parsed.data, enumerable: true, writable: true, configurable: true });
    }
    return result;
  });
}

/** Historical records outside the old lossless domain are refused, never reinterpreted. */
export function assertLegacyJsonDomain(value: JsonData): void {
  if (value === null || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor') reject('unsupported_legacy_json_key');
    assertLegacyJsonDomain((value as Record<string, JsonData>)[key]!);
  }
}

/** Validate and copy a whole protocol envelope before ordinary shape access. */
export function jsonShape<S extends z.ZodType>(schema: S) {
  return z.preprocess((value, ctx) => {
    try { return cloneJsonData(value); }
    catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof JsonDataError ? error.code : 'json_invalid_data' }); return z.NEVER; }
  }, schema);
}
