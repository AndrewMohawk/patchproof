# Runtime worker boundaries

`repair/index.ts` exports the bounded scripted demonstration provider and a
Token Factory completion adapter. The scripted provider supports only the public
`stable-unique-01` task and reports zero inference calls. Its next proposal depends
on current source and observed feedback, never a variant name. It must not be used
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

`sandbox/nebius.ts` contains only documented HTTP mappings with injected
transports: `POST /instances`, `GET /operations/{operationId}` and
`DELETE /operations/{operationId}`. Auth uses IAM Bearer plus `Project`.
`NebiusSandboxCheckRunner` explicitly refuses execution until account controls,
image, memory/PID/CPU bounds, cancellation and billing are verified. In particular,
the public request schema shows network disablement and a layer-size limit but
does not establish the local Docker containment controls. Transport unit tests
are not sponsor smoke evidence. There is no fallback from Nebius to local Docker.

Official interfaces inspected on 2026-09-27:

- https://docs.tokenfactory.nebius.com/quickstart
- https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion
- https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance
- https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/get-an-operation-status
- https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation
- https://docs.tokenfactory.nebius.com/sandboxes/cli/tutorial/configuration

No SDK is installed or vendored. The current official SDK integration guide
reports mini-SWE-agent/Contree constructor incompatibility, so this package does
not silently install an unverified version combination.
