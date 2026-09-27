import { inspectContractLocks } from './contract-locks.ts';

const checks = await inspectContractLocks(new URL('../', import.meta.url));
for (const check of checks) console.log(`${check.status}: ${check.detail}`);
if (checks.some(check => check.status !== 'pass')) throw new Error('Contract lock validation failed; a reviewed current or historical binding is missing.');
console.log('Contract byte checks do not satisfy independent execution, access or release gates.');
