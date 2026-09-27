import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { digestBytes, digestJson } from '../packages/contracts/src/digest.ts';
import { loadFixtures } from '../packages/orchestrator/src/fixtures.ts';
import { buildOperationalLock } from '../packages/orchestrator/src/operational-lock.ts';
import type { Configuration } from './config.ts';
import { readiness } from './config.ts';
import { buildReleaseBindings, validateReleaseReceipts } from './release-receipts.ts';
import type { ReleaseBindings } from './release-receipts.ts';
import { readReleaseFile } from './release-files.ts';

type Item = { id: string; status: 'pass' | 'blocked' | 'not_run'; detail: string };
export interface ReleaseAuditEvidence { bindings: ReleaseBindings; receipts: unknown[]; trustedReceiptDigests: string[]; now?: Date; }

/** Local inspection only. This command neither runs paid checks nor publishes. */
export async function auditRelease(root: URL, config: Configuration, evidence?: ReleaseAuditEvidence) {
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
  checks.push({ id: 'hosting_assignment', status: config.owner.demoOperator && config.budget.stages.hosting > 0 ? 'pass' : 'blocked',
    detail: `Operator ${config.owner.demoOperator ?? 'unassigned'}; hosting allocation $${config.budget.stages.hosting}.` });
  const operational = buildOperationalLock(fileURLToPath(root));
  const current = buildReleaseBindings({ sources: operational.sources, runtime: config.runtime, protocol: operational.behavior,
    runtimeMode: config.runtime.mode, liveProtocolFrozen: operational.liveProtocolFrozen, bundleDigests: evidence?.bindings.bundleDigests ?? [] });
  checks.push({ id: 'release_binding', status: !evidence || digestJson(current) === digestJson(evidence.bindings) ? 'pass' : 'blocked',
    detail: 'Compared release bindings against current source, runtime and operational behavior.' });
  const assessment = await validateReleaseReceipts({ bindings: current, receipts: evidence?.receipts ?? [], trustedReceiptDigests: evidence?.trustedReceiptDigests ?? [],
    readArtifact: path => readReleaseFile(fileURLToPath(root), path), ...(evidence?.now ? { now: evidence.now } : {}) });
  for (const gate of assessment.gates) checks.push({ id: gate.id, status: gate.status === 'pass' ? 'pass' : gate.status === 'missing' ? 'not_run' : 'blocked', detail: `${gate.status}: ${gate.detail}` });
  if (assessment.malformedCount) checks.push({ id: 'receipt_schema', status: 'blocked', detail: `${assessment.malformedCount} malformed receipts rejected.` });
  // This former unconditional blocker is now represented by the live_smoke receipt gate.
  const blockers = readiness(config).filter(detail => detail !== 'Real-provider smoke, sandbox isolation and billing reconciliation have not been verified; no automatic fallback.');
  for (const detail of blockers) checks.push({ id: 'configuration', status: 'blocked', detail });
  return { command: 'release-check', status: checks.every(check => check.status === 'pass') ? 'ready_for_owner_handoff' : 'blocked', mode: config.runtime.mode, competitionReady: false,
    paidCalls: 0, experimentEpisodesExecuted: 0, checks, blockers, receiptAssessment: assessment,
    note: 'Local content/receipt audit only. Accepted records do not authenticate claims. Publication, hosting and entry remain separate owner actions.' };
}
