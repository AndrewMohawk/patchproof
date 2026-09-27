# Local reviewer guide

This walkthrough demonstrates scripted repair proposals with actual local checks.
It does not establish model quality or competition readiness.

The current catalogue is the frozen v2 corpus. This is the procedure for its
handoff. Source `c335031` passes all 585 tests, the actual browser comparison and
all three fresh-container patch replays; see the
[integration record](../research/verification/20260927-corpus-v2-integration/README.md).
Prior source-bound walkthroughs remain historical evidence. Old runs must display
their saved task context, not the new catalogue's text for a reused task ID.

1. Start `make dev`, open the loopback URL and select **Retain first occurrences throughout a list** (`stable-unique-01`). Read the
   three explicit requirements and visible mock-mode notice.
2. Choose **Compare all three**. Wait for each actual run to finish. The context
   match requires the same contract version, immutable task/source/policy,
   runtime lock and allowance. A resource allowance is not measured consumption.
3. Open PatchProof evidence. If a rejected candidate is present, inspect its recorded
   failing checks and requirement mappings. Expected and observed values come
   from the checker; a narrative is not proof.
4. If a candidate is accepted, inspect it, the selected diff, all requirement mappings,
   process logs and operation handles. “Verified for declared checks” covers
   those finite cases only. Unchecked requirements remain unverified. Otherwise,
   inspect the recorded failure, abstention or infrastructure error without
   relabeling it as a successful repair.
5. Download the bundle to `artifacts/<run-id>.json` and run
   `make reproduce RUN=<run-id>`. It applies the patch in a fresh workspace and
   reruns checks in the pinned image. No model inference is repeated.
6. Inspect the ordinary baseline's actual verdict and recorded visible and
   acceptance results. The scripted comparison does not demonstrate that
   branching beats a real baseline.
7. Inspect an unsupported task in the picker: launch is disabled and it requires
   a connected model. The CLI abstention is also tested and exports no fake patch.

The app cannot merge, publish or submit. Evidence hashes detect inconsistent
content; they are not signatures establishing who created an artifact. The
public source clone intentionally has no sealed task contents or gold solutions.
A separate evaluator adjudicates frozen final selections without repair feedback.

The automated browser walkthrough is a development check. It is not an uncoached
reviewer study, usability timing result, independent clean-machine verification
or public demo availability proof.
