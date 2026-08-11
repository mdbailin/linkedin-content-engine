#!/usr/bin/env tsx
/**
 * Read-only Buffer schema diagnostic.
 *
 *   DRY_RUN=false npm run dump:buffer                    # queries + mutations
 *   DRY_RUN=false npm run dump:buffer -- ShareMode ...   # named types
 *
 * Handles INPUT_OBJECT (inputFields), ENUM (enumValues), OBJECT (fields).
 * Sends introspection queries only. Never writes.
 */
import { loadConfig } from '../src/config.js';
import { createBufferTransport } from '../src/adapters/buffer.js';

interface TypeRef {
  kind: string;
  name: string | null;
  ofType?: TypeRef | null;
}

// Four levels deep: covers [AssetInput!]! and similar nesting.
const TYPE_REF = `
  kind
  name
  ofType { kind name ofType { kind name ofType { kind name } } }
`;

const ROOT_QUERY = /* GraphQL */ `
  query LceSchemaDump {
    __schema {
      queryType { fields { name args { name type { ${TYPE_REF} } } } }
      mutationType { fields { name args { name type { ${TYPE_REF} } } } }
    }
  }
`;

const TYPE_QUERY = /* GraphQL */ `
  query LceTypeDump($name: String!) {
    __type(name: $name) {
      name
      kind
      description
      inputFields { name description type { ${TYPE_REF} } }
      enumValues { name description }
      fields { name type { ${TYPE_REF} } }
    }
  }
`;

function renderType(type: TypeRef | null | undefined): string {
  if (!type) return '?';
  if (type.kind === 'NON_NULL') return `${renderType(type.ofType)}!`;
  if (type.kind === 'LIST') return `[${renderType(type.ofType)}]`;
  return type.name ?? type.kind;
}

const short = (text: string | null | undefined): string =>
  text ? `   # ${text.split('\n')[0]!.slice(0, 90)}` : '';

const config = loadConfig();
if (config.DRY_RUN) {
  console.error('Set DRY_RUN=false (inline is fine) and BUFFER_API_KEY.');
  process.exit(2);
}
const transport = createBufferTransport(config);
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));

if (requested.length === 0) {
  const schema = (await transport(ROOT_QUERY)).data as {
    __schema: {
      queryType: { fields: Array<{ name: string; args: Array<{ name: string; type: TypeRef }> }> };
      mutationType: { fields: Array<{ name: string; args: Array<{ name: string; type: TypeRef }> }> };
    };
  };
  for (const [label, root] of [
    ['QUERIES', schema.__schema.queryType],
    ['MUTATIONS', schema.__schema.mutationType]
  ] as const) {
    console.log(`\n=== ${label} ===`);
    for (const field of root.fields) {
      const args = field.args.map((a) => `${a.name}: ${renderType(a.type)}`).join(', ');
      console.log(`  ${field.name}(${args})`);
    }
  }
  console.log('\nRe-run with type names to expand, e.g. npm run dump:buffer -- ShareMode AssetInput\n');
} else {
  for (const name of requested) {
    const result = (await transport(TYPE_QUERY, { name })).data as {
      __type: {
        name: string;
        kind: string;
        description: string | null;
        inputFields: Array<{ name: string; description: string | null; type: TypeRef }> | null;
        enumValues: Array<{ name: string; description: string | null }> | null;
        fields: Array<{ name: string; type: TypeRef }> | null;
      } | null;
    };
    const type = result.__type;
    if (!type) {
      console.log(`\n=== ${name} === (not found)`);
      continue;
    }
    console.log(`\n=== ${type.name} (${type.kind}) ===${short(type.description)}`);
    for (const field of type.inputFields ?? []) {
      console.log(`  ${field.name}: ${renderType(field.type)}${short(field.description)}`);
    }
    for (const value of type.enumValues ?? []) {
      console.log(`  ${value.name}${short(value.description)}`);
    }
    for (const field of type.fields ?? []) {
      console.log(`  ${field.name}: ${renderType(field.type)}`);
    }
  }
  console.log('');
}
