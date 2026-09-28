# Actual Token Factory access validation

The owner supplied project access and reiterated that both an interactive demo
and a video are required. The existing $25 aggregate ceiling remains unchanged.
The credential is stored in an owned private file outside the repository and
candidate workspaces. It is absent from these artifacts and command arguments.

This work establishes **model inference access only**. No model-generated repair,
sponsor sandbox execution, model selection, pilot or final evaluation occurred.
The operational application still defaults to explicit mock execution.

## Actual observations

1. Authenticated `GET /v1/models?verbose=true`: HTTP 200, 25 models, four NVIDIA
   IDs. The account's IDs, quantizations, contexts and prices are preserved in
   [discovery.json](discovery.json). Original parsed response and headers stay
   private; the original response-byte digest and canonical parsed-body digest
   are distinct. The discovery happened at 00:01 UTC September 28, still
   September 27 in the owner's America/New_York timezone.
2. Authenticated sandbox `GET /sandboxes/v1/whoami` without project context:
   HTTP 400, `Missing "Project" header`. This does not establish sandbox
   entitlement. The owner has been asked for project ID and enabled access.
3. One `POST /v1/chat/completions` to the exact account Nano model: HTTP 200,
   expected `PATCHPROOF_OK` marker, exact returned model, `stop`, no returned
   reasoning, 24 input and 6 completion tokens. Start/finish times, response and
   request IDs and response digest are in
   [access-check-execution.json](access-check-execution.json). Elapsed time was
   0.569 seconds. There was no retry, fallback or second inference request.

At the observed $0.06/$0.24 per-million rates, reported usage implies
**$0.00000288 estimated**, not an invoice. Actual billed cost remains `null`.
The sole private real-spending ledger durably reserved **$0.10 before dispatch**
and retains it pending authoritative reconciliation. It reports $24.90 uncommitted
but currently freezes new dispatch for pending billing. Do not replace or reset
that ledger. A zero charged field means no accepted billing receipt, not proven
zero provider spend. No credits were claimed.

The reservation conservatively prices the full 262,144-token catalog context as
both input and output ($0.0786432). The request additionally specifies both output
limits as 32, one completion, non-streaming, disabled storage and the documented
reasoning-off flag. This access-only bound avoids assuming a calibrated tokenizer.
The observed marker response does not validate general tokenization or model
quality. No hidden reasoning text is retained in the result.

## Commands and review

Source before this task: `3e749a5db90e0b223555975d85f57ba3f93c668b`.
The exact executed [one-off script](model-access-check.mjs) digest is
`sha256:b8843112a807eb134dd7a5c708c90c261e8a61e5631c670662ad3d271bb811e5`.
Its intent binds this digest, catalog digest and approved budget digest. It is a
historical access control, not a replacement for the guarded repair operator.

| Command/action | Exit/result |
|---|---|
| Bounded authenticated model discovery, credential read through `readPrivateOperatorJson` | 0; HTTP 200 |
| Bounded authenticated sandbox introspection | 0; HTTP 400 retained as blocker |
| `node --check research/verification/20260927-account-access/model-access-check.mjs` | 0 |
| `node research/verification/20260927-account-access/model-access-check.mjs --preflight /PRIVATE/OPERATOR` | First exit 2 before network/reservation: receipt held parsed JSON, not raw text. Corrected to validate both known digests; final exit 0. |
| Same script with `--execute /PRIVATE/OPERATOR` | 0; one inference, zero sandbox executions |
| `make doctor` | 0; default runtime remains mock, no paid calls from diagnosis |
| `npm run check:contracts` | 0; shared contracts unchanged |
| `gitleaks git --staged --redact --no-banner` | 0; no findings, no scan exceptions |
| Guarded real repair / `make smoke` | NOT RUN: sandbox project/entitlement, image/controls, tokenizer calibration and billing are unresolved. |

The source review identified and resolved credential echoes through retained
header/decoded IDs and missing fsync on exclusive intent/result files. See the
[bounded independent review](independent-review.json). Source review does not
authenticate external results. A local diagnostic also initially attempted to
parse an already parsed catalog body and failed before any provider call; no
receipt was replaced to hide that preparation error.

The [official source ledger](official-sources.json) identifies current API
versions, document URLs and price interpretation. Nebius describes observability
as operational metrics, not billing reconciliation. Authoritative request-level
charges were not available from the documented monitoring API.

## Demo and remaining work

Both deliverables remain required: the interactive local product/archive and a
readable recorded walkthrough with source/run/video custody. Until a sponsor
repair actually runs, their patch story remains explicitly scripted mock with
real local checks. This marker result cannot be substituted into repair evidence.

Project ID can be copied from Token Factory **Project settings → menu under the
project name → Copy project ID**, per the
[official instructions](https://docs.tokenfactory.nebius.com/ai-models-inference/observability-api-integrations).
Next sandbox discovery requires that value and access; its billing, isolation,
resource controls and cleanup still need verification. Public hosting, video or
source publication and competition entry are not authorized by a local recording.
