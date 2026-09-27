# Third-party dependencies

Versions and package-integrity hashes are pinned in `package-lock.json`.
Upstream license files remain in the installed packages; no third-party source
has been copied into PatchProof implementation files. Install lifecycle scripts
are disabled. No SWE-Gate, mini-SWE-agent, OpenHands or Aider code/data is vendored.

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
and sponsor SDK/image. The PatchProof project license itself is not selected yet.

The installed Python/Alpine container, Docker engine, host Python and BusyBox are
external runtime prerequisites, not copied into this repository. The runtime
guide pins the observed image and identifies BusyBox. Their upstream image and
component notices must accompany any future redistributed runtime image; this
source checkout does not grant additional redistribution rights.
