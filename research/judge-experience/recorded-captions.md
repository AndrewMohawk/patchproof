# Recorded demo captions

These lines are burned into the actual 135.20-second recording. They can also serve as presenter cues. The video reviews saved real runs and does not initiate new inference.

- 1.7–9.7s: You maintain a Python library. In this curated example, remove duplicates without changing the caller's original list.
- 9.7–16.7s: The input contains elm twice. The current output keeps both copies. The required output keeps the first elm, then ash and birch.
- 16.7–23.7s: You ask for a fix. PatchProof checks the model's proposed code, then keeps the patch and results together for your review.
- 24.1–33.1s: The original condition only compares with the previous item. The proposed condition checks every item already kept.
- 33.1–42.1s: The model can edit solution.py. The check definitions stay outside that file; a separate runner tests the proposal.
- 42.5–53.5s: Before repair, 5 of 9 checks passed. This proposal passes all 9, including unchanged input and TypeError for None.
- 53.5–64.5s: A passing result covers the listed cases. You still inspect the full patch and decide whether to use it. Nothing is merged automatically.
- 65.0–76.0s: Here is a separate repair that failed. Rows become columns, but a real null cell must stay null. The fill value is only for missing cells.
- 76.0–87.0s: This patch still replaces null with 9. Only 11 of 13 checks pass, so it is not accepted. Later attempts had check errors.
- 87.6–95.6s: Inspect the saved source change before using it. The added code keeps an item only when it is not already in the result.
- 96.1–108.1s: Open an actual check: expected and observed outputs match. The recorded observations also show the original input was left unchanged.
- 108.7–120.7s: Download the patch, requirements and recorded observations for review. These examples explain the workflow, not a benchmark advantage.
- 121.2–128.2s: To try it yourself, choose a curated Python task and select Generate patch. It starts a new model run and checks the proposal.
- 128.2–135.2s: Then review the patch and its results. This public demo uses curated examples; it does not accept your own repository.
