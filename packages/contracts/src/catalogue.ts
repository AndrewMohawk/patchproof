import { TaskSchema } from './index.ts';
import { digestJson } from './digest.ts';

// Schema-only data. T03's owned fixtures and sealed suite have not been authored.
const source = { purpose: 'contract_fixture', files: [] };
const policy = {
  editAllowlist: [],
  requirements: [{ id: 'R01', text: 'Demonstrate honest mock labeling without executing a candidate.' }],
};

const CONTRACT_TASK = TaskSchema.parse({
  id: 'contract-smoke',
  title: 'Contract inspection fixture',
  description: 'Exercise the request, event and export contracts. This is not a repair or evaluation task.',
  requirements: policy.requirements,
  repoDigest: digestJson(source),
  policyDigest: digestJson(policy),
  executable: false,
  purpose: 'contract_fixture',
});

export function catalogue() { return [structuredClone(CONTRACT_TASK)]; }
