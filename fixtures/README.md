# Owned maintenance fixtures

This suite contains 60 original, benign Python maintenance tasks across twelve synthetic fixture repository IDs, five tasks per ID. Four repositories provide 20 development tasks, two provide 10 calibration tasks, and six provide 30 final tasks. The splits share no repository IDs.

`development/` and `calibration/` contain the 30 publishable fixture JSON files. Their starting source, public checks and frozen runtime acceptance checks conform to `FixtureSchema`. The candidate repair provider receives only the source, requirements and ordinary visible checks; the controller owns runtime acceptance checks. Gold source and every sealed evaluation oracle remain outside this repository, including gold source for development tasks.

`split-manifest.json` records task IDs, repository IDs, split counts, and SHA-256 hashes of the exact UTF-8 fixture/oracle JSON bytes. It exposes no final task statements, source or oracle vectors. Final IDs are opaque. Changes require a new manifest and protocol decision; after final outcomes have been observed, a changed protocol is exploratory.

`stable-unique-01` is the development demonstration. Its `unique(values)` API preserves first occurrence order, leaves the caller list unchanged, and raises `TypeError` for `None`. The immutable check driver snapshots call arguments; mutation checks do not rely on an editable helper inside the candidate source.

All fixture source, descriptions and check data were authored for PatchProof on September 27, 2026 and are dedicated under CC0-1.0. No external benchmark or downloaded repository code was copied. See `LICENSE-CC0.txt`. Fixture licenses do not change the license of the application or its dependencies.

These are independently identified synthetic repositories, not twelve independently sampled real projects. They share an authoring process, Python runtime and function-call test format. Repository separation prevents direct task sharing across splits but does not eliminate family resemblance or demonstrate generalization to real maintenance workloads.

Oracle preparation runs gold and buggy starts in fresh, network-disabled containers, then repeats gold checks. Its aggregate artifact is `oracle-validation-summary.json`; detailed results remain with the sealed workspace. Revisions preserve original manifests, sources, oracles and observations. Changed fixtures are rerun; unchanged observations are retained only when both exact fixture and oracle hashes match.

A separate evaluator-only agent reviewed all 60 tasks and 563 case definitions, identifying 25 findings. All findings were corrected and checked again. Independent isolated probes confirmed three original semantic discrepancies and two original nonmutation coverage gaps; the corrected semantics pass and the two negative-control implementations are now rejected. The root-safe record is `independent-review-summary.json`. This is independent AI review with executable probes; human review has not been performed, and the reviewer did not independently rerun the production runner on all 60 tasks.

This is executable fixture preparation, **not a repair-model benchmark**. Finite JSON-value checks do not establish return-object identity, arbitrary Python object behavior, unbounded numeric precision or universal correctness. Eleven sealed boundary assertions repeat visible/runtime inputs; empty and `None` boundaries are not always expressible as novel examples. Human scope review, protocol freeze and real provider integration remain separate gates. Neither these fixtures nor local mock runs establish competition readiness.
