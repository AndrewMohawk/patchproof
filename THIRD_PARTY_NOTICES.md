# Licensing scope and third-party notices

The root [MIT license](LICENSE) covers original PatchProof application source and
project documentation, except material carrying its own license or notice. The
owner selected MIT for release preparation on October 13, 2026. The existing
[CC0 dedication](fixtures/LICENSE-CC0.txt) for original fixture material remains
unchanged. Third-party packages, model weights, runtime images, trademarks, and
media are not relicensed by the root license.

Public-release review remains open. In particular, verify the provenance and
redistribution terms of any screenshots, fonts, recording assets, and synthetic
narration/reference audio before including or republishing them. The hosted demo's
existence and its technical playback receipts do not establish those rights.
No general redistribution permission for third-party or media assets is asserted.

## Third-party dependencies

Versions and package-integrity hashes are pinned in `package-lock.json`.
Upstream license files remain in the installed packages. Install lifecycle scripts
are disabled. The prior dependency inventory recorded no third-party source
copied into implementation files and no vendored SWE-Gate, mini-SWE-agent,
OpenHands, or Aider code/data. This documentation-only preparation does not
independently establish those provenance claims; copied/vendored-source review
remains part of the release audit.

| Package | Version | License | Upstream |
|---|---|---|---|
| @huggingface/tokenizers | 0.2.0 | Apache-2.0 | <https://github.com/huggingface/tokenizers.js> |
| Zod | 4.1.12 | MIT | <https://github.com/colinhacks/zod> |
| TypeScript | 5.9.3 | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| @types/node | 25.5.0 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| undici-types | 7.18.2 | MIT | <https://github.com/nodejs/undici> |
| Playwright / playwright-core | 1.58.2 | Apache-2.0 | <https://github.com/microsoft/playwright> |
| fsevents (optional macOS dependency) | 2.3.2 | MIT | <https://github.com/fsevents/fsevents> |

License metadata was checked against npm package records and the installed
lockfile on 2026-09-27. Browser binaries are not committed/distributed in this
repository; Playwright downloads include their own notices. The local Node
runtime is external to this repository. A full redistribution/license audit is
still required before the public release, including any selected NVIDIA model
and sponsor SDK/image. Selecting MIT for first-party code does not waive that audit.

The installed Python/Alpine container, Docker engine, host Python and BusyBox are
external runtime prerequisites, not copied into this repository. The runtime
guide pins the observed image and identifies BusyBox. Their upstream image and
component notices must accompany any future redistributed runtime image; this
source checkout does not grant additional redistribution rights.

The September 28 live development configuration calls the hosted
`nvidia/nemotron-3-super-120b-a12b` model through Nebius Token Factory; no model
weights are downloaded or redistributed. Its upstream
[NVFP4 model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4)
links the [NVIDIA Nemotron Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/).
The checked card revision and account catalog receipt are preserved in
`research/product-v3/model-discovery.json`. The hosted weights revision and
tokenizer equivalence remain unverified. This receipt records historical model research, not
acceptance of additional terms or authorization to redistribute model weights.
