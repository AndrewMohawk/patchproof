# Build decisions

## Authority and revised build sequence — 2026-09-27

The owner requested a complete build, a new GitHub repository and ongoing
commits. `AndrewMohawk/patchproof` was created privately. The owner confirmed
eligibility/conflict review, contribution rights and AI-assisted development,
then approved **$25 total**. The coordinator reserves $5 for smoke and $20 for
pilot, with zero allocation for final evaluation or hosting. No expiry was
specified; credits remain unverified. NVIDIA token rates were checked during
account discovery. One marker call has a $0.00000288 usage-priced estimate;
actual billing is unverified, with $0.10 held pending reconciliation.

When asked for scoped provider access, the owner instructed: **“just build the
whole thing and we can get that afterwards.”** This explicitly supersedes the
original sequencing restriction for local implementation: fixtures, runtime,
repair policies and the full UI may be built before account access and G2.
It does not pass G0/G1/G2, authorize spending beyond the cap, or make mock results
competition evidence. `owner-decisions.json` records this exception. No repeated
spending approval is needed within the existing ceiling. The owner later supplied
Token Factory access, as recorded below.

Private repository creation and pushes are authorized. Public source/video,
public hosting, event entry, accepting terms and auto-merge remain unauthorized.
Application license selection is pending; npm metadata remains `UNLICENSED`.
Synthetic fixtures have their own explicit CC0 dedication.

All seven initial non-ZIP files were read and six package hashes verified before
tracker changes. The ZIP was not opened. No home-directory credential search,
private-repository inspection or homelab discovery was used to obtain access.

## Local contracts and runtime

The historical v1 mock contract scaffold is retained. Product contracts v2 add
curated Python fixtures, candidate records, real check observations, durable runs
and replayable bundles. Locked contract digests and exact npm versions document
the local freeze; they are not a real-provider protocol freeze.

The app uses a task-bounded scripted repair provider and the installed immutable
Python image. Local checks observe function return/exception/argument behavior;
expected values and check definitions remain in the trusted parent. Candidate
source is mounted read-only into fresh no-network containers. The runtime guide
states remaining kernel/process trust, cleanup and CPU-accounting limitations.

Only stable-unique-01 has scripted proposals. Other tasks abstain honestly.
There is no generic source-solution lookup or final oracle callback. B0/B1/P
share configured aggregate limits; scripted behavior demonstrates plumbing only.
An API live request is refused. No runtime setting alone activates paid execution.

The provider HTTP adapters, guarded smoke/experiment factories and private
operators are implemented with injected-transport tests. They refuse real
execution until account, model, image, isolation and billing requirements are
verified. The [smoke operator](docs/trusted-smoke-operator.md) and
[experiment operator](docs/live-experiment-operator.md) document that boundary.
Fake-transport results do not establish account-specific behavior or completed
Nebius integration. The owner subsequently supplied Token Factory access; the
actual [catalog and one-call marker validation](research/verification/20260927-account-access/README.md)
passed. Sponsor sandbox, tokenizer/control calibration and actual billed-cost
reconciliation remain unresolved.

## Evaluation and claims

An evaluator author works in a separate sibling workspace, never mounted into
candidate containers. An independent reviewer examines oracle intent and benign
negative controls. Agents share a Unix identity during authoring, so that is a
procedural boundary; production final evaluation needs a separate trusted account.
Gold/start/repeat tests validate fixture preparation, not model repair quality.
Corrections and prior manifests are preserved before any scored experiment.

The 72/270 grids, matched allowances, failure denominators, sealed adjudication
boundary and repository-cluster bootstrap are implemented as offline tools.
No scored episodes have run. No pilot go decision or superiority claim exists.
Mini-SWE-agent remains an unexecuted alternative; the implemented B0 is a small
native repair loop and must be disclosed as such in future comparisons.

UI polish proceeds under the owner's local-build exception. Real measurements
still determine whether to retain branching, simplify to checks-only or pass on
the competition. No final-set outcome was inspected by repair agents.

## Evidence and release

Runs persist in SQLite; exports are immutable and content-addressed. Fresh replay
applies the exported diff and reruns frozen declared checks in the pinned image.
Hashes establish consistency, not identity/authenticity. Runtime/model/usage
fields distinguish script, measured zero provider spend and unknown CPU use.

No public demo, sponsor-backed recording, final report, signed release or event
submission exists. Local draft assets and operations instructions do not satisfy
those gates. The release tracker preserves each missing item explicitly.

The owner emphasized both an interactive demonstration and a video on September
27. Prepare and verify both locally, preserving the recorded execution mode and
source/run custody. The supplied Token Factory credential stays in a private
operator file outside the repository, candidate workspaces and logs. The existing
$25 ceiling applies; the one real account-control call holds $0.10 in the sole
durable project ledger pending authoritative billing. Do not replace that ledger
to evade its unresolved-cost hold. The successful control is neither a repair
episode nor model selection. Public hosting, source/video publication and entry
remain separate owner release decisions.

## 2026-09-28 — Real public demo on the owner's FQDN

The owner explicitly requested a real implementation and deployment on andrewmohawk.xyz, including an accessible recording. This authorizes this app/video deployment on the existing homelab. It does not authorize public source licensing, competition entry, or new spending above $25. `owner-decisions.json` records public demo authorization.

Use actual Token Factory Nano inference with independently controlled local Docker checks for this public development demo. The account's successful model call and model catalog are preserved in `research/verification/20260927-account-access/`. Nebius Sandboxes project access and execution controls remain unresolved; this deployment must not claim that backend or completion of the Coding and Agentic Engineering track requirement. The existing sponsor adapter and its gates remain unchanged.

The default ledger policy still blocks unknown billing. This trusted runtime explicitly opts into covered closed inference: retain the full allowance for every unresolved charge, bind complete request/response inventories and conservative rate/token caps, and permit subsequent work only if prior exposure remains fully covered. The original marker reservation is preserved. This is not invoice reconciliation or a reset of the budget.

All three repair variants use the same fixed live allowances. The actual baseline runs first, and results—including unsuccessful attempts—remain visible. No superiority claim follows from this small unscored demonstration. Public release uses a pinned source checkout, a private Unix socket, rate-limited fixed routes, and a frontend with no host execution credentials.

The first deployed real run exposed a strict-umask workspace permission defect and is retained as Needs review with all three billed attempts. Correct the source-file/directory modes explicitly and require a benign container control at service startup before inference. The observed container lifecycle overhead also justifies live-local timing v2: up to120seconds per repeated check batch, within the unchanged300second episode budget for all variants. This is development runtime preparation; no sealed final result or benchmark was consulted. The original60second policy remains replayable.

## Visible failure diagnostics — September 28, 2026

The first corrected live development sequence at `7467626` ran two arms: ordinary repair failed after three attempts, while checks-only passed all declared checks on its first attempt. The third arm was not run under that source. Source review found that the common repair-input mapper omitted visible case IDs and structured observed exceptions, leaving generic requirement-level feedback. This could weaken retries; the observed outcomes alone do not establish causation or an advantage.

Before the public three-arm recording, `visible-outcome-feedback-v1` supplies bounded diagnostics for cases already visible to every approach. It derives expected values from the public case definitions, leaves additional acceptance checks opaque, and excludes raw logs and sealed data. All approaches use the same mapper and retain identical call/token/wall/spend limits. The new runs are exploratory development observations under a new immutable source lock. The original failed setup and incomplete two-arm sequence remain preserved; no scored or sealed experiment was changed or run.

## 2026-09-28 — More involved public repair examples

The owner requested richer code-and-goal briefings, a full app explanation, symmetric successful/failed examples, annotated narration, and contextual GitHub-style diffs. Ten new public-development fixtures each exercise several interacting maintenance rules through 22 declared checks. They have separate identities and a frozen manifest; the original split and prior results are preserved. This is product demonstration work, not a revised scored experiment.

Two real Nano runs on the larger configuration and pagination tasks produced no accepted patch. Both remain public with their original runtime and limits. Configuration reached its five-minute deadline during a later attempt; pagination's second response proposed an unauthorized path. The resulting execution errors are distinguished from the first proposals' functional check failures.

For subsequent development runs, use the account-verified `nvidia/nemotron-3-super-120b-a12b` model. The September 28 catalog receipt is `research/product-v3/model-discovery.json`; its observed prices are $0.30/$0.90 per million input/output tokens and no request fee. Each of the three requests conservatively reserves an entire 262,144-token input context and at most 4,000 output tokens. The aggregate upper estimate is $0.2467296, covered by a $0.25 reservation in the existing $5 smoke allocation and $25 project ceiling. All repair variants share those limits and a 600-second wall deadline. No prior budget holds are released or reset; token-rate estimates remain distinct from provider invoices. The model is requested with the existing thinking-disable override; no reasoning-content claim is made.

The shared prompt now explicitly requires exact editable paths, actual changed source, and preservation of unrelated formatting/comments/license notices. No additional acceptance definitions, reference repairs, sealed checks, extra attempts, or final-set feedback are supplied. Changes to model, prompt and deadline make these new development observations unmatched to the earlier Nano demonstrations. Historical evidence is verified with its original patch format; new evidence uses contextual unified diffs.
