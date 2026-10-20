# Offline Humanize diagnosis

No paid calls, upstream fix inspection, deployment, submission changes or ledger changes were made for this diagnosis. The three historical run outcomes remain failures.

## Findings

- All six reconstructed requests match their recorded request digests exactly. Every request contained the declared requirements and visible examples, with the expected original-source or progressive feedback. The retained four candidate bodies round-trip through the historical/current parser into exactly the saved source. See `offline-request-audit.json`.
- The two malformed responses are **not available as raw content**. The accounting journal contains response hashes, request identities and usage, not bodies. Their JSON syntax versus schema error cannot be retroactively determined. The new safe diagnostic categories are prospective, not a retrospective diagnosis.
- Three of four retained candidates have the original executable AST after docstring removal. The remaining candidate only changes already-nonnegative microsecond fields. None fixes signed timedelta normalization. These are genuine semantic failures, not adapter corruption.
- The adapter preserves the sign and unit of every input. Python represents negative sub-day timedeltas with negative days and nonnegative seconds/microseconds. For example, -7 microseconds has days=-1, seconds=86399, microseconds=999993; taking separate component magnitudes does not produce an absolute elapsed duration. `offline-semantic-audit.json` records all seven negative cases using standard-library arithmetic without executing upstream code on the host.
- A separately constructed **hand-written feasibility control** passed all 20 unchanged checks with both observations and 40 fresh isolated containers, entirely inside the allowed function body. It is not a model repair, selected candidate, deployable demo artifact or scored result. Its source exists only in `/tmp/patchproof-humanize-offline-audit.mjs`, outside the repository's model-input source. It was not sent to a model. The original fixture and all saved candidates were unchanged. See `offline-feasibility-control.json`.
- One wording ambiguity existed: R01 said timedelta durations, while a numeric-negative case requires the same absolute-distance behavior. R01 now explicitly covers numeric-second inputs too. Source, check definitions and expected results are byte-for-byte/data-identical; prior evidence is untouched. This clarification cannot explain the visible timedelta failures or malformed responses.

## Minimum justified next experiment (approval still required)

Keep strict validation and do not normalize signs in the protected adapter, strip code fences, guess missing JSON fields, or repair candidate code. That would hide failure or change semantics.

First verify the selected model's constrained-output support and test a files-and-summary JSON schema with exactly the editable path and no extra properties. Existing `json_object` requests do not constrain field names or field types. The new static failure categories make a format probe informative even if it fails. Nebius's general schema documentation was reviewed before this offline task; selected-model support is not established here.

For the semantic repair attempt, explicitly separate the editable function body from read-only context. Current requests contain 63–67 KB of JSON, including a 9,311-byte protected metadata adapter and unrelated package functions. Focused context can remove irrelevant material while preserving the complete package unchanged in checking/evidence. Do not include this feasibility control, a golden patch or private check answers in model input. Keep the same model, independent checks, body restriction, token/call/time limits and reservation.

These changes could reduce format failures and context distraction. They do not establish a successful model repair, and another identical attempt is not justified. Further inference remains gated by the exhausted three-run authorization.
