# Humanize historical maintenance demonstration

Pinned upstream: `python-humanize/humanize` at `1399e049734bd7c779b38fa64dd02742b6aadb06`, issue #171 (2024). This is a historical regression reproduction, not a novel discovery or a current unpatched bug.

The fixture preserves all five upstream Python modules byte for byte and the MIT license. `provenance.json` records module hashes, the wheel built from this checkout, actual wheel metadata, and isolated build dependencies. The protected adapter converts JSON microseconds into `timedelta`, loads this metadata and calls the actual package. No runtime dependencies are installed in checker containers. Scope is English duration formatting, not the full upstream test suite or translated locales.

Only the body of `naturaldelta` may change. The model receives the original package source, requirements and visible examples, but no upstream patch. A body-only response is expanded by the controller into a full-source candidate. Prefix, signature, suffix, adapter and helper modules are protected. Both proposal handling and evidence validation enforce the edit region; fixture bytes are included in operational source binding. Existing historical evidence retains its bytes and pinned checkout.

`baseline.json` contains two independent original-source rounds: each has 13 passing and 7 failing checks, no infrastructure errors, and confirmed container cleanup. The initial missing-image setup failure is retained in `setup-failure.json`; the exact approved image digest was restored before rerunning. No baseline observation used model inference.

`integration-tests.log` records 22 passing protocol, edit-boundary, provenance, source-binding, historical contract and repair-feedback tests. The test setup now creates the fixture and model-discovery directories required by the operational lock. It also verifies that changing a fixture invalidates the lock.

Paid repair, fresh candidate replay, deployment, footage and submission results must be recorded separately after they occur. Their absence is not success. The limit for this demonstration is at most three $0.25 reservations within the existing $25 project cap; unresolved historical holds remain untouched. No upstream PR or automatic merge is part of this reproduction.

## First two supervised runs

Run `a7b1b65b-0af3-4bf9-ac42-372d2c590cda` used the original-source branching policy: three candidates each scored 13/20 and were rejected. Run `f775b3bf-763c-440a-a029-7d698da9dc70` used the existing progressive baseline policy and stopped after one malformed files-and-summary response; no candidate executed. Both immutable evidence bundles are retained. Token estimates total $0.026139, while both full $0.25 reservations remain held. The startup attempt before the first run made no model call or reservation; its missing-image failure is retained separately.

The function-region prompt had conflicting full-file/body-only wording. This was removed, and strict JSON encoding requirements made explicit. The original malformed response body was not retained, so this ambiguity is a suspected contributor, not a proven explanation of that response. Strict parsing and protected edit checks remain unchanged. All 19 focused follow-up tests and type checking pass. The third and final authorized demonstration run uses this corrected protocol, with the same fixture/checks and resource limits.
