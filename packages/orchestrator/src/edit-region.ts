import { ContractError } from '../../contracts/src/index.ts';
import type { Fixture } from '../../contracts/src/product.ts';
export function validateEditRegion(fixture: Fixture, files: Record<string, string>): void {
  const region = fixture.editRegion;
  if (!region) return;
  const original = fixture.files[region.path], candidate = files[region.path];
  if (!fixture.editAllowlist.includes(region.path) || typeof original !== 'string' || typeof candidate !== 'string' ||
      !original.startsWith(region.prefix) || !original.endsWith(region.suffix) ||
      !candidate.startsWith(region.prefix) || !candidate.endsWith(region.suffix) ||
      candidate.length <= region.prefix.length + region.suffix.length) {
    throw new ContractError('invalid_request', 'Changes outside the frozen function body are forbidden.');
  }
  const body = candidate.slice(region.prefix.length, candidate.length - region.suffix.length);
  if (!body.endsWith('\n') || body.split('\n').some(line => line.trim() && !line.startsWith('    '))) {
    throw new ContractError('invalid_request', 'Replacement body must remain indented inside the frozen function.');
  }
}
