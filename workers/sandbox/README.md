# Runtime worker boundaries

`repair/index.ts` exports the bounded scripted demonstration provider and a
Token Factory completion adapter. The scripted provider supports only the public
`stable-unique-01` task and reports zero inference calls. Its next proposal depends
on repair attempt and observed feedback, never a variant name. It must not be used
to calculate model success or comparative evaluation scores.

For another curated public task, when original-source checks complete without an
infrastructure error, the coordinator retains those checks and exports
`needs_review` with `mock_task_unavailable`. There
is no candidate or selected patch; provider calls, tokens and added provider cost
remain zero. Its replay result is `no_selected_patch`, with no execution performed;
abstention is never presented as a successful repair.

The inference adapter requires an injected credential supplier, transport,
explicit authorization, account-verified exact NVIDIA model identifier, rates
and a model-specific prompt-token counter. It never reads ambient credentials.
It uses the documented `POST /v1/chat/completions` interface and retains attempted
calls in typed errors. Token-derived cost bounds are estimates; measured provider
cost remains null until billing reconciliation. Account access, tokenizer
accuracy and exact model response behavior have not been integration-tested.

`sandbox/index.ts` exports `DockerCheckRunner` and `createLocalRuntime()`. The
factory inspects an already installed immutable Python image; it never pulls.
The observed local Linux amd64 image is:

- image ID: `sha256:3dc0132ee978305990b529498077dbe8ab756c7e655221cad18d807feb878a51`
- repository digest: `python@sha256:79e7a9b9ff1cbceff819f856fb374477792a5967759d94df266de7b7b4120e6f`
- observed tag: `python:3.13-alpine`, inspected 2026-09-27

Each function case gets a fresh container. The only host bind mount contains
task-owned candidate Python source and is read-only. The immutable generic
driver receives `{function,args,kwargs}` over stdin. Oracle expected values,
requirement identifiers, check definitions and evaluator code never enter the
container. The driver emits observations; the host compares returns, exception
names and post-call arguments against expected outcomes. Candidate output saying
"pass" cannot approve a check.

Containers use no network, read-only rootfs, no capabilities, no-new-privileges,
UID/GID 65534, 32 PIDs, 128 MiB memory with no added swap, 0.5 CPU, a five-second
per-process CPU limit, 64 file descriptors and a bounded 16 MiB tmpfs. The host
caps output at 128 KiB and enforces the batch wall deadline. Docker `--init`
keeps Python out of PID 1. The pinned image's `/bin/busybox` (v1.37.0, inspected
2026-09-27) runs `timeout -s KILL` around the driver, with no more than the batch's
remaining seconds. This separate timer bounds execution after the container
starts even if the host watchdog disappears. Cancellation kills
the Docker client and separately removes its named container; cleanup failures
remain infrastructure errors and stop the batch before another case can start.
The coordinator must pass each batch only its remaining aggregate wall allowance.
Sequential execution plus the 0.5 CPU quota supplies a conservative nominal
resource envelope, not an exact CPU-seconds counter: scheduler quota periods can
allow short bursts. Exact CPU consumption is unknown (`null`), not fabricated
from wall time. This is not evidence of matched measured CPU in a paid experiment.
Local added provider spend is zero; electricity is not
measured.

When the coordinator supplies `ownerRunId`, each container carries that exact
UUID in `org.patchproof.run-id`. `onOperation` runs synchronously before Docker
starts; a journaling exception prevents execution. Recovery requires the caller
to hold the coordinator lease and prove the prior owner dead. `reconcile(runIds)`
lists only those exact run labels, inspects each container's ownership labels,
removes matched containers and lists again to confirm absence. It never removes
other runs or unlabelled evaluator containers. Unconfirmed cleanup returns an
error and any remaining operation handles.

Every Docker CLI invocation uses a fixed trusted `/usr/bin/python3 -I -S`
launcher on Linux. It sets `PR_SET_PDEATHSIG(SIGKILL)`, verifies its original
parent PID before and after setting the signal, rejects privileged executables,
then execs `/usr/bin/docker`. This kills the Docker client when the coordinator's
spawning thread dies. Missing launcher/prctl support or other operating systems
fail closed. The host executes only this fixed launcher, never candidate Python.

Recovery is not atomic with Docker daemon work: a create request accepted before
client death can become visible after a recovery listing. Repeat run-scoped
reconciliation if delayed daemon work is suspected. An already accepted container
has the independent wall timer once execution starts (at most the runner's
validated 900-second batch cap; the product coordinator supplies at most 30
seconds). Daemon queue/start latency is outside that execution bound. No immediate
or atomic crash-cleanup guarantee is claimed.

Process-control references: [Linux PR_SET_PDEATHSIG](https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html)
(Linux man-pages 6.19, page dated 2026-02-08) and
[Docker run --init](https://docs.docker.com/reference/cli/docker/container/run/#specify-an-init-process),
inspected 2026-09-27.
CPU quota periods and short-burst caveats are documented in
[Linux CFS Bandwidth Control](https://docs.kernel.org/scheduler/sched-bwc.html),
also inspected 2026-09-27.

This is a benign maintenance-fixture harness, not a hardened service for arbitrary
hostile Python. Containers share the host kernel. The observation driver and
candidate share a Python process; sophisticated process introspection can affect
observations. No general anti-tampering guarantee is claimed. Do not expose an
arbitrary-code upload route or mount oracle files to improve convenience.

`sandbox/nebius.ts` implements injected HTTP transport for raw `POST /files`,
`POST /instances`, `GET /operations/{operationId}` and
`DELETE /operations/{operationId}`. The documented HTTP prefix is
`https://api.tokenfactory.nebius.com/sandboxes/v1`; the CLI service base omits
`/v1`. Auth uses injected IAM Bearer plus `Project`, with a required project match
when used by the runner. Redirects are refused. Credential resolution, requests
and response reads have deadlines; responses are limited to 1 MiB and decoded
output to 128 KiB per stream. Provider error bodies and thrown transport messages
are discarded. The transport never follows an operation's returned `Location`.

`NebiusSandboxCheckRunner` now has a conditional lifecycle implementation. Its
default constructor still returns `sandbox_controls_unverified` before credential
access. Execution requires explicit authorization, an approved spend allowance
and a current `SandboxVerification` record binding a project and image UUID to
an immutable image digest. Dated evidence references must cover account access,
image contents (including the fixed Python executable), equivalent isolation,
filesystem protection, memory/PID/CPU caps, disabled networking, cancellation,
upload retention and billing. These are trusted control-plane records, not
self-authenticating evidence and never public task input. No actual account
verification record exists in this repository. Public API documentation exposes
network disablement, execution timeout and a writable-layer limit; it does not
expose Docker's memory/PID/CPU, read-only-rootfs, capability or privilege flags.
The adapter does not invent such provider flags.

Source uploads are checked against the returned SHA256 and known size. Each case
uses a fresh pinned image, uploaded source references with mode `0444`, UID/GID
65534, disabled networking, no inherited environment, disposable state and a
timeout floored to the remaining batch seconds. Source, driver and invocation
arguments enter the sandbox; expected values and checks remain on the host.
Completed `metadata.result` output must be explicitly untruncated and carry a
successful process state before the existing host comparator runs. Check failures
are observations, never candidate claims of success. Polling is bounded by both
the batch deadline and 1000 status requests per operation; server retry advice is
bounded to two seconds. Queue/start latency is outside the provider's documented
execution-timeout semantics. A batch can refuse to launch when fewer than one
whole execution second remains.

The attested CPU quota must be finite and positive; it is not restricted to the
local Docker runner's 0.5 CPU setting. Before live wiring, the coordinator must
derive each batch's wall allowance from the remaining episode CPU allowance and
the attested quota, allowing for verified scheduling and cleanup behavior, as
well as the remaining episode wall budget. A quota receipt alone is not proof of
matched CPU consumption. Measured CPU remains unknown until the provider reports
it. A positive timeout below one second returns `sandbox_batch_timeout` before
credential access or spending; it is never rounded up for a repeated check.

`onOperation` journals upload/instance intent handles before dispatch, and known
file/operation UUID handles immediately on response. Failure to journal an intent
prevents its request. Failure to journal a known operation triggers independent
cancellation and polling while preserving the journal error. Every returned
handle remains in the result. `DELETE` acceptance alone is not cleanup proof;
terminal status must be observed before another case can start. Cleanup polling
has its own five-second default deadline, separate from the cancelled caller.
Unconfirmed cleanup stops the batch. These API mappings have only fake-transport
tests; cancellation and output conventions still need a real authorized probe.

No creation idempotency key or client UUID is documented. A lost creation response
therefore leaves an explicit unconfirmed intent, without automatic retry or a
claim that no remote operation exists. There is no run-label crash reconciliation
mapping here. The public index also provides no uploaded-file deletion endpoint;
files may remain after disposable execution. Retention and associated charges
must be covered by the verified record. The runner reserves its verified
conservative full-batch charge ceiling before side effects and never refunds it
from API cost values. This raw-runner allowance is process-local. The separate
trusted smoke factory adds a durable aggregate reservation and conditional
coordinator path; see [trusted smoke boundaries](../../docs/trusted-smoke.md).
Public API/CLI live selection and automated live crash recovery remain unwired.
Restarting a runner is not authorization for a new budget.

Reported `consumed_cpu` values are summed only when every submitted operation has
a terminal measurement; missing or ambiguous observations leave CPU `null`.
`resources.cost` is retained as `providerCostUnspecifiedUnit`, because the public
schema does not name a currency. `measuredCostUsd` remains `null`, including failed
and cancelled requests. Tests do not establish measured sponsor costs or matched
paid evaluation. There is no fallback from Nebius to Docker and no live API/CLI
selection has been added.

Official interfaces inspected on 2026-09-27:

- https://docs.tokenfactory.nebius.com/quickstart
- https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion
- https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance
- https://docs.tokenfactory.nebius.com/api-reference/sandboxes/files/upload-a-file-to-the-server-the-body-must-be-a-file-content
- https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/get-an-operation-status
- https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation
- https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/configuration

No SDK is installed or vendored. The current official SDK integration guide
reports mini-SWE-agent/Contree constructor incompatibility, so this package does
not silently install an unverified version combination.

The T04 source ledger is `research/nebius-sandbox-sources.json`: official source
URLs, inspection timestamps and content hashes, OpenAPI version `1.0.0`, documented
mappings and remaining account-dependent unknowns. The status page failed through
the web reader but its official `.md` representation was fetched successfully.
No publication dates were supplied, so inspection dates are not release dates.
`tests/nebius-*.test.ts` are fake-transport unit/contract tests only. Live sponsor
smoke, real image/control verification, billing and real cancellation: **NOT RUN**
because account access and verified controls are absent.
