import { readFile } from 'node:fs/promises';
import { digestBytes } from '../packages/contracts/src/digest.ts';
import { loadFixtures } from '../packages/orchestrator/src/fixtures.ts';
import type { Configuration } from './config.ts';
import { readiness } from './config.ts';

type Item = { id: string; status: 'pass' | 'blocked' | 'not_run'; detail: string };

/** Local inspection only. This command neither runs paid checks nor publishes. */
export async function auditRelease(root: URL, config: Configuration) {
  const checks: Item[] = [];
  for (const filename of ['research/contracts-v1-lock.json', 'research/contracts-v2-lock.json']) {
    const lock = JSON.parse(await readFile(new URL(filename, root), 'utf8')) as { files: Record<string, string> };
    const matches = await Promise.all(Object.entries(lock.files).map(async ([path, digest]) => digestBytes(await readFile(new URL(path, root))) === digest));
    checks.push({ id: filename, status: matches.every(Boolean) ? 'pass' : 'blocked', detail: 'Checked all recorded source digests.' });
  }
  const fixtures = await loadFixtures(root);
  checks.push({ id: 'public_fixtures', status: fixtures.length === 30 && fixtures.every(f => f.license === 'CC0-1.0') ? 'pass' : 'blocked', detail: `${fixtures.length} schema-valid public fixtures; sealed workspace not inspected.` });
  const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const versions = Object.values({ ...metadata.dependencies, ...metadata.devDependencies });
  checks.push({ id: 'dependency_pins', status: versions.every(v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) ? 'pass' : 'blocked', detail: 'Direct npm versions are exact; license notices still require final release review.' });
  checks.push({ id: 'application_license', status: config.owner.openSourceLicense && metadata.license !== 'UNLICENSED' && metadata.license === config.owner.openSourceLicense ? 'pass' : 'blocked', detail: 'Owner-selected application license must agree with package metadata.' });
  checks.push({ id: 'owner_release', status: config.owner.publicSourceAuthorized && config.owner.publicDemoAuthorized && config.owner.entryAuthorized ? 'pass' : 'blocked', detail: 'Public source, demo and entry are separately controlled by the owner.' });
  checks.push({ id: 'hosted_judge_access', status: 'blocked', detail: `No deployment verified; operator ${config.owner.demoOperator ?? 'unassigned'}; hosting allocation $${config.budget.stages.hosting}.` });
  for (const [id, detail] of Object.entries({
    live_smoke: 'Two sponsor-backed cases, actual operation IDs and reconciled billing are not available.',
    pilot: '0 of 72 scored pilot episodes; no continuation decision.',
    sealed_evaluation: '0 of 270 final episodes; no scored ablation or reviewer study.',
    independent_replay: 'No independent clean-machine reviewer replay has been recorded.',
    release_secrets: 'This command does not run a secret scanner; inspect the separately recorded staged scan.',
    current_rules: 'Recheck official rules before owner-controlled entry; current source ledger is not an entry approval.',
  })) checks.push({ id, status: 'not_run', detail });
  return { command: 'release-check', status: 'blocked', mode: 'mock', competitionReady: false,
    paidCalls: 0, experimentEpisodesExecuted: 0, checks, blockers: readiness(config),
    note: 'Local audit only. Live execution and public release remain unavailable; no setting alone activates them.' };
}
