#!/usr/bin/env tsx
/**
 * Read-only diagnostic: dump what Buffer's GraphQL schema actually offers, so
 * src/adapters/buffer-operations.ts can be corrected against fact rather than
 * assumption.
 *
 * Usage: DRY_RUN=false npm run dump:buffer
 * Sends one introspection query. Never writes.
 */
import { loadConfig } from '../src/config.js';
import { createBufferTransport } from '../src/adapters/buffer.js';

const DUMP_QUERY = /* GraphQL */ `
  query LceSchemaDump {
    __schema {
      queryType {
        fields {
          name
        }
      }
      mutationType {
        fields {
          name
          args {
            name
            type {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
`;

const INPUT_TYPE_QUERY = /* GraphQL */ `
  query LceInputDump($name: String!) {
    __type(name: $name) {
      name
      kind
      inputFields {
        name
        description
        type {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
`;

interface TypeRef {
  kind: string;
  name: string | null;
  ofType?: TypeRef | null;
}

function renderType(type: TypeRef | null | undefined): string {
  if (!type) return '?';
  if (type.kind === 'NON_NULL') return `${renderType(type.ofType)}!`;
  if (type.kind === 'LIST') return `[${renderType(type.ofType)}]`;
  return type.name ?? type.kind;
}

const config = loadConfig();
if (config.DRY_RUN) {
  console.error('Set DRY_RUN=false (inline is fine) and BUFFER_API_KEY.');
  process.exit(2);
}

const transport = createBufferTransport(config);

const schema = (await transport(DUMP_QUERY)).data as {
  __schema: {
    queryType: { fields: Array<{ name: string }> };
    mutationType: {
      fields: Array<{ name: string; args: Array<{ name: string; type: TypeRef }> }>;
    };
  };
};

console.log('\n=== QUERIES ===');
console.log(schema.__schema.queryType.fields.map((f) => f.name).join(', '));

console.log('\n=== MUTATIONS ===');
for (const field of schema.__schema.mutationType.fields) {
  const args = field.args.map((a) => `${a.name}: ${renderType(a.type)}`).join(', ');
  console.log(`  ${field.name}(${args})`);
}

// Dump every input type referenced by post-related mutations.
const postMutations = schema.__schema.mutationType.fields.filter((f) => /post/i.test(f.name));
const inputTypeNames = new Set<string>();
for (const mutation of postMutations) {
  for (const arg of mutation.args) {
    const name = renderType(arg.type).replace(/[![\]]/g, '');
    if (name && name !== '?') inputTypeNames.add(name);
  }
}

for (const typeName of inputTypeNames) {
  const result = (await transport(INPUT_TYPE_QUERY, { name: typeName })).data as {
    __type: { name: string; kind: string; inputFields: Array<{ name: string; description: string | null; type: TypeRef }> | null } | null;
  };
  const type = result.__type;
  if (!type?.inputFields) continue;
  console.log(`\n=== ${type.name} ===`);
  for (const field of type.inputFields) {
    const description = field.description ? `   # ${field.description.split('\n')[0]}` : '';
    console.log(`  ${field.name}: ${renderType(field.type)}${description}`);
  }
}

console.log('');
