# JSON contract 2.2 verification

The implementation preserves own JSON dictionary keys throughout product cases, observations and evidence. Original 2.1 contract sources/lock remain exact snapshots; admitted 2.0/2.1 evidence keeps its original projection and digest formulas, with explicit rejection outside the historical lossless key domain.

Final focused suite: **68 passed, 0 failed**, exit 0. Typecheck and contract locks: exit 0. All inputs were invented metadata; coordinator tests use injected scripted callbacks and never execute candidate source. SQLite export and loopback archive checks preserve exact bytes. No interpreter/container execution, external model/provider call, corpus validation or paid operation was performed.

`review.json` binds commands, source/test hashes, limitations and separate coordinator-reported historical checks. The coordinator reported all 14 stored actual 2.0/2.1 exports unchanged against this branch; final commit-bound verification and the complete project suite belong to that separate integration pass.

Failures are retained: `typecheck-before-fix.log` records initial implementation typing errors; `stale-current-version-assertion.log.json` preserves the exact original test output asserting 2.1 after new creation moved to 2.2. The latter stores output as a JSON string to preserve whitespace without introducing diff warnings. The frozen parser's original special-key behavior is also reproduced explicitly by a passing regression that contrasts it with the corrected parser.

Log footer markers record the actual command exit code; all preceding captured output bytes are preserved. This receipt demonstrates implementation behavior and compatibility, not real-provider readiness or a newly executed benchmark.
