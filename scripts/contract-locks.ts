import { readFile } from 'node:fs/promises';
import { digestBytes } from '../packages/contracts/src/digest.ts';

type Lock = { version: string; files: Record<string, string> };
export interface ContractLockCheck { id: string; status: 'pass' | 'blocked'; detail: string; }

/** Current code and historical byte snapshots have distinct, explicit inventories. */
export async function inspectContractLocks(root: URL): Promise<ContractLockCheck[]> {
  const checks: ContractLockCheck[] = [];
  for (const [filename, version] of [['research/contracts-v1-lock.json', '1.0'], ['research/contracts-v2.2-lock.json', '2.2']] as const) {
    let valid = false;
    try {
      const lock = JSON.parse(await readFile(new URL(filename, root), 'utf8')) as Lock;
      const matches = await Promise.all(Object.entries(lock.files).map(async ([path, digest]) => digestBytes(await readFile(new URL(path, root))) === digest));
      valid = lock.version === version && matches.length > 0 && matches.every(Boolean);
    } catch { /* Missing or malformed evidence blocks; it never becomes a passed check. */ }
    checks.push({ id: filename, status: valid ? 'pass' : 'blocked', detail: `Current contract ${version}: checked all recorded source digests.` });
  }
  const historicalRoot = 'research/contracts-history/2.1/';
  let historicalValid = false;
  try {
    const original = await readFile(new URL('research/contracts-v2-lock.json', root));
    const snapshot = await readFile(new URL(historicalRoot + 'contracts-v2-lock.json', root));
    const lock = JSON.parse(original.toString('utf8')) as Lock;
    const paths: Record<string, string> = {
      'packages/contracts/src/product.ts': historicalRoot + 'product.ts',
      'packages/contracts/src/product-validation.ts': historicalRoot + 'product-validation.ts',
    };
    const matches = await Promise.all(Object.entries(lock.files).map(async ([path, digest]) =>
      Boolean(paths[path]) && digestBytes(await readFile(new URL(paths[path]!, root))) === digest));
    historicalValid = original.equals(snapshot) && lock.version === '2.1' && matches.length === Object.keys(paths).length && matches.every(Boolean);
  } catch { /* Historical evidence is required, even when current contracts validate. */ }
  checks.push({ id: 'research/contracts-history/2.1/contracts-v2-lock.json', status: historicalValid ? 'pass' : 'blocked',
    detail: 'Historical contract 2.1: checked original lock bytes and both exact source snapshots; current 2.2 separately binds explicit legacy readers.' });
  return checks;
}
