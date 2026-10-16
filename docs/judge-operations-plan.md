# Judge operations through December 15, 2026, 20:00 UTC

This is a concrete operating plan, not an installed monitor or an availability
commitment. Generation remains paused. Existing read-only walkthroughs and
recorded evidence remain free to access. This plan authorizes no extra spending,
hosting purchase, credential creation, reservation release or expiry extension.

## Truthful demo scope

Use the verified configuration-overlay run as the primary demonstration:
https://patchproof.andrewmohawk.xyz/#evidence/352bcf84-ffa2-4668-801c-af258ea79e2c

Keep pagination's rejected run visible:
https://patchproof.andrewmohawk.xyz/#evidence/3171cb35-a100-4b01-92b9-0a51642992b6

The first demonstrates a real model repair passing all 22 repeated checks.
The second demonstrates refusing three incorrect patches, each passing 21/22.
Exact reconstruction matches all three dispatched request digests: the complete
explicit tie-order requirement reached the model. No context, parser or
coordinator defect was found. More identical paid retries are unjustified.
This is a limitation of the observed bounded model configuration, not a claim
that the model can never solve the task. Do not manufacture success by weakening
checks, exposing protected expected answers, or installing a hand-written patch.

The read-only application is useful today, but does not establish availability
of new generation. Whether it satisfies entry requirements remains a separate
submission review; no competition-readiness claim is made here.

## Capacity and accounting

The ceiling is $25 TOTAL through the deadline, including historical usage and
fees. The ledger retains $2.35 in holds and has $22.65 project capacity. The
current $5 smoke allocation has $2.65 available: ten additional $0.25 holds.
The $20 pilot allocation is separate; live admission currently uses only smoke.

The arithmetic project ceiling is at most 90 additional reservations at current
rates, NOT 90 currently available public or guaranteed judge runs. Failures,
verification calls, price changes and unresolved fees consume capacity. Every
unknown charge keeps its full hold; aggregate dashboard usage cannot reconcile
individual reservations. Preserve the original $1.60 historical holds.

Owner decision proposed: designate the existing $20 pilot allocation for judge
generation and retain smoke for verification. This changes purpose within the
existing ceiling; record approval before changing admission accounting. Use one
global atomic ledger, never duplicate its allowance in another budget. Prevent
anonymous public use from consuming reserved judge capacity. A reviewed access
or queue design is required; creating credentials or expanding persistent access
requires separate approval. No such access change is implemented by this plan.

## Required pricing and monitor implementation

Current pricing expires October 17 at 21:00 UTC, so the existing 600-second guard
stops admission at 20:50 UTC. A one-day receipt cannot cover the judging period.
Do not change that date without new verification.

1. Implement a bounded hourly read-only monitor with the existing credential.
   Read the authenticated exact model/context/quantization/rates/request fee,
   private ledger, public health/admission and active-run age. Never infer,
   purchase, top up, release holds, create keys or unpause. Retain minimal
   timestamped receipts and bounded logs without secrets or billing PII.
2. Separate renewable external evidence from immutable code. Bind a versioned
   verification policy to the source, approved cap and expected model/rates;
   bind each receipt to that policy, raw observation digests, account-fee
   evidence, verifiedAt and a short validUntil. Reject missing/malformed/future
   or stale evidence, policy mismatch, changed rates and unknown fees. This
   requires implementation and tests; the current hardcoded daily receipt must
   not be silently extended or treated as a maintenance mechanism.
3. Admission and every paid dispatch must validate the current receipt and
   original run deadline. A monitor that only alerts is insufficient: stale or
   failed monitoring must block generation. An unchanged catalog cannot renew
   unknown account fees. No refresh may clear an operator or financial freeze,
   change the cap, or increase token/call/time/isolation allowances.
4. Establish authoritative account-fee verification. No supported per-operation
   billing endpoint has been verified; the observed dashboard is aggregated.
   Until a reliable machine-readable fee source is established, a named operator
   must review account pricing/fees before each renewal. Never invent a
   multi-month freshness period to avoid this work. Missing renewal leaves the
   read-only experience available and generation clearly unavailable.
5. Test exact expiry, missing/stale evidence, clock skew, changed model/prices/
   fees, catalog failure, source-policy mismatch, monitor crash, exhausted
   stage/project capacity, concurrent admission and restart recovery with all
   holds preserved. Deploy paused, validate no-cost failure cases, and only then
   consider one explicitly bounded supervised renewal check if necessary.

## Owner decisions and operational responsibilities

| Item | Next action | Approval or dependency |
| --- | --- | --- |
| Monitor and evidence gate | Implement the controls above and retain failure-injection results | Preparation fits maintenance scope; any admission/accounting change requiring approval must be reviewed explicitly. No new access or spending. |
| Operator coverage | Name primary and backup, renewal frequency and incident response responsibility through Dec 15 | The owner must accept this ongoing commitment; a one-time repair task cannot establish it. |
| Notifications | Choose destination and recipients for stale evidence, failed health, low capacity or uncertain accounting | External messaging and recurring notifications need explicit authorization. |
| Judge allocation | Decide on the proposed $20 purpose allocation and access/queue design | No cap increase. New credentials or persistent access require separate approval. |
| Existing host | Confirm continued use of the existing machine, storage headroom and bounded logs | No unrelated service shutdown or paid hosting is authorized. New hosting costs require separate approval. |
| Reopening | Verify renewal controls, finite reserved capacity, operator ownership and healthy checks; use audited resume at the current ledger checkpoint | Never automatic; financial freezes and all unresolved holds remain protected. |

Alert on any disabled admission or accounting uncertainty. Treat five or fewer
available judge reservations as low capacity and zero as exhausted. Monitoring
itself makes no paid calls. Avoid routine container probes under load; use a
bounded no-cost baseline after runtime changes or observed health failure,
serialized with paid work.

At December 15, 20:00 UTC authorization expires. Preserve the 600-second guard:
last admission is 19:50 UTC if all other evidence remains valid. Stop paid
admissions and preserve accounting/receipts. Continue read-only hosting only
within existing authorization. No automatic renewal, purchase or extension.
