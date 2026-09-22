import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A cheap guard for the persistence boundary: only the adapters, the entities and the module
// that registers them may know about TypeORM. Everything else talks to a port.
const dir = join(__dirname, '../src/requests');
const files = readdirSync(dir).filter((file) => file.endsWith('.ts'));

const mayUsePersistence = (file: string) =>
  file.startsWith('typeorm-') || file.endsWith('.entity.ts') || file === 'requests.module.ts';

// Ports, models and rules must not even know a framework exists.
const frameworkFree = [
  'classification-log.ts',
  'classification-provider.ts',
  'classification-rules.ts',
  'request-lifecycle.ts',
  'request-model.ts',
  'request-store.ts',
];

const importsOf = (file: string): string[] =>
  [...readFileSync(join(dir, file), 'utf8').matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(
    (match) => match[1],
  );

const isPersistence = (specifier: string) =>
  specifier === 'typeorm' ||
  specifier.startsWith('typeorm/') ||
  specifier === '@nestjs/typeorm' ||
  specifier.endsWith('.entity');

describe('persistence boundary', () => {
  it('is looking at the files it is meant to police', () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.filter(mayUsePersistence)).toEqual(
      expect.arrayContaining(['typeorm-request-store.ts', 'typeorm-classification-log.ts']),
    );
    expect(frameworkFree.filter((file) => !files.includes(file))).toEqual([]);
  });

  it.each(files.filter((file) => !mayUsePersistence(file)))(
    '%s does not import TypeORM or an entity',
    (file) => {
      expect(importsOf(file).filter(isPersistence)).toEqual([]);
    },
  );

  it.each(frameworkFree)('%s imports no framework at all', (file) => {
    expect(importsOf(file).filter((s) => s.startsWith('@nestjs/') || s === 'typeorm')).toEqual([]);
  });
});
