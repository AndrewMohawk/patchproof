import { readdir, readFile } from 'node:fs/promises';
import { FixtureSchema, PRODUCT_CONTRACT_VERSION } from '../../contracts/src/product.ts';
import type { Fixture, ProductContractVersion } from '../../contracts/src/product.ts';
import { digestJson } from '../../contracts/src/digest.ts';
import { ContractError } from '../../contracts/src/index.ts';

export function validatePaths(files: Record<string, string>, allowlist?: string[]) {
  if (Object.keys(files).length > 20) throw new ContractError('invalid_request', 'Too many source files.');
  let bytes = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.py$/.test(path) || path.length > 160 ||
        (allowlist && !allowlist.includes(path))) throw new ContractError('invalid_request', 'Protected or invalid source path.');
    bytes += Buffer.byteLength(content);
  }
  if (bytes > 100_000) throw new ContractError('invalid_request', 'Source exceeds 100 KiB.');
}

export function fixtureDigests(fixture: Fixture, version: ProductContractVersion = PRODUCT_CONTRACT_VERSION) {
  const sourceDigest = digestJson(fixture.files);
  if (version === '2.0') {
    // Frozen historical formula. Version 2.0 did not bind task descriptions or metadata.
    return { sourceDigest, policyDigest: digestJson({
      requirements: fixture.requirements, editAllowlist: fixture.editAllowlist,
      entrypoint: fixture.entrypoint, visibleCases: fixture.visibleCases, acceptanceCases: fixture.acceptanceCases,
    }) };
  }
  if (version === '2.1' || version === '2.2') {
    const { files: _sourceFiles, ...policy } = fixture;
    return { sourceDigest, policyDigest: digestJson(policy) };
  }
  throw new ContractError('invalid_request', 'Unsupported fixture digest version.');
}

export async function loadFixtures(root: URL): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];
  for (const split of ['development', 'calibration']) {
    const directory = new URL(`fixtures/${split}/`, root);
    let names: string[];
    try { names = await readdir(directory, { recursive: true }) as string[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const name of names.filter(name => name.endsWith('.json')).sort()) {
      const raw = JSON.parse(await readFile(new URL(name, directory), 'utf8'));
      if (!raw.id || !raw.files) continue; // Metadata manifests are not tasks.
      const fixture = FixtureSchema.parse(raw);
      if (fixture.split !== split) throw new Error('Fixture split does not match public directory.');
      validatePaths(fixture.files);
      validatePaths(Object.fromEntries(fixture.editAllowlist.map(path => [path, ''])));
      if (!(fixture.entrypoint in fixture.files)) throw new Error('Fixture entrypoint missing.');
      const requirements = new Set(fixture.requirements.map(r => r.id));
      const checks = [...fixture.visibleCases, ...fixture.acceptanceCases];
      if (checks.some(c => !requirements.has(c.requirementId)) || new Set(checks.map(c => c.id)).size !== checks.length) {
        throw new Error('Fixture checks have ambiguous or unknown requirement mappings.');
      }
      fixtures.push(fixture);
    }
  }
  if (new Set(fixtures.map(f => f.id)).size !== fixtures.length) throw new Error('Duplicate fixture IDs.');
  return fixtures;
}

export function publicTask(fixture: Fixture) {
  const { id, repoId, split, title, description, requirements, files, entrypoint, editAllowlist } = fixture;
  return { id, repoId, split, title, description, requirements, files, entrypoint, editAllowlist,
    examples: structuredClone(fixture.visibleCases), mockSupported: id === 'stable-unique-01', ...fixtureDigests(fixture) };
}
