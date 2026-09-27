# ARC shortlist reassessment — research-spike candidates, not quick wins

Research date: September 25, 2026. This is a feasibility note, **not** a completed competition-entry PRD or measured recommendation.

## Material constraint found

ARC Prize’s official 2026 overview distinguishes the static ARC-AGI-2 and interactive ARC-AGI-3 tracks and says Kaggle evaluation runs **without internet access**, excluding API-based solutions at evaluation time. [S13] A development agent may help write the system, subject to applicable rules; that does not mean a submitted system may call that development agent or a hosted frontier model.

## Why more work is required before recommending a large build

The live Kaggle page did not expose its rules/leaderboard as readable content in this research. Exact competition-runtime limits, currently competitive scores and complete track-specific eligibility therefore remain unverified here. I am not converting public research results into a claim about the current prize leaderboard.

An ARC-AGI-3 world-model ablation paper reports strong public-set results while explicitly leaving held-out performance untested and noting the model postdates the public games. [S14] That is evidence for an experimental direction, not proof it transfers to unseen competition tasks. A separate graph-exploration paper provides a potential lighter baseline, but its reported results concern a preview setting. [S15]

## Proposed next experiment, before a full PRD

**ARC-AGI-3:** Verify exact current rules and available execution environment; obtain the official starter; implement the allowed observation/action adapter; reproduce a lightweight exploration baseline; measure a minimal learned/world-model extension under identical action and runtime limits. Keep task-specific heuristics and hidden solutions out. Use a genuinely held-out or organizer-provided evaluation, not only the public games the implementation has already seen.

**ARC-AGI-2:** Verify current notebook budget and scoring; reproduce the current official starter and one license-compatible open baseline; profile memory and task throughput on the actual allowed environment; run a controlled small improvement rather than assuming a general code-agent scaffold is novel enough.

**Decision gate:** A build PRD requires an exact executable environment, reproducible baseline, a tested budget fit and a falsifiable strategy for improving the relevant metric. No API-only plan may be called competition-compatible without official evidence. Lack of present evidence is not evidence that progress is impossible.

**Owner cost policy:** No new paid training/API/compute spend without authorization. Start with permitted existing resources. A failed baseline reproduction becomes a concrete blocker report, not an invented score.

This package prioritizes a full Nebius product PRD now because its required product surface and judging rubric could be inspected directly. It does not claim that either ARC track is unwinnable.

[S01]: https://nebiusglobalaihackathon.devpost.com/ "Nebius × NVIDIA event overview"
[S02]: https://nebiusglobalaihackathon.devpost.com/rules "Nebius × NVIDIA official rules"
[S03]: https://nebiusglobalaihackathon.devpost.com/project-gallery "Current event project gallery"
[S04]: https://github.com/SWE-agent/mini-swe-agent "mini-SWE-agent repository"
[S05]: https://github.com/OpenHands/software-agent-sdk "OpenHands Software Agent SDK"
[S06]: https://github.com/OpenHands/software-agent-sdk/blob/main/LICENSE "OpenHands SDK license"
[S07]: https://aider.chat/docs/usage/lint-test.html "Aider linting/testing documentation"
[S08]: https://arxiv.org/html/2609.04167v1 "SWE-Gate paper, September 3, 2026"
[S09]: https://github.com/DeepSoftwareAnalytics/SWE-Gate "SWE-Gate replication repository"
[S10]: https://docs.tokenfactory.nebius.com/quickstart "Nebius Token Factory quickstart"
[S11]: https://docs.tokenfactory.nebius.com/sandboxes/overview "Nebius Sandboxes overview"
[S12]: https://docs.tokenfactory.nebius.com/sandboxes/swe-agents "Nebius Sandboxes for SWE agents"
[S13]: https://arcprize.org/competitions/2026 "ARC Prize 2026 official overview"
[S14]: https://arxiv.org/abs/2607.15439 "ARC-AGI-3 world-model ablation study"
[S15]: https://arxiv.org/abs/2512.24156 "ARC-AGI-3 graph-exploration paper"
[S16]: https://docs.tokenfactory.nebius.com/public-serverless "Nebius public serverless endpoint documentation"
