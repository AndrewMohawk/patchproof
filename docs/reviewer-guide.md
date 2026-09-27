# Local reviewer guide

This walkthrough demonstrates scripted repair proposals with actual local checks.
It does not establish model quality or competition readiness.

1. Start `make dev`, open the loopback URL and select **Stable unique**. Read the
   three explicit requirements and visible mock-mode notice.
2. Choose **Compare all three**. Wait for each actual run to finish. The context
   match requires the same contract version, immutable task/source/policy,
   runtime lock and allowance. A resource allowance is not measured consumption.
3. Open PatchProof evidence. Select its first candidate and inspect the failing
   order check. The nonmutation requirement is a separate check. Expected and
   observed values come from the recorded checker; a narrative is not proof.
4. Inspect the accepted candidate, selected diff, all requirement mappings,
   process logs and operation handles. “Verified for declared checks” covers
   those finite cases only. Unchecked requirements remain unverified.
5. Download the bundle to `artifacts/<run-id>.json` and run
   `make reproduce RUN=<run-id>`. It applies the patch in a fresh workspace and
   reruns checks in the pinned image. No model inference is repeated.
6. Inspect ordinary baseline evidence as well: it retains its failed acceptance
   check even though its visible tests passed. The scripted difference does not
   demonstrate that branching beats a real baseline.
7. Inspect an unsupported task in the picker: launch is disabled and it requires
   a connected model. The CLI abstention is also tested and exports no fake patch.

The app cannot merge, publish or submit. Evidence hashes detect inconsistent
content; they are not signatures establishing who created an artifact. The
public source clone intentionally has no sealed task contents or gold solutions.
A separate evaluator adjudicates frozen final selections without repair feedback.

The automated browser walkthrough is a development check. It is not an uncoached
reviewer study, usability timing result, independent clean-machine verification
or public demo availability proof.
