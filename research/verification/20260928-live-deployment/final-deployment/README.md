# Public deployment verification

The current runtime verification is in
`release-3d0ce9d-under-load/deployment-receipt.json`, observed at
2026-09-28 01:43:47 UTC while a real curated repair was executing.

- Runtime release: `3d0ce9d33b2169efec6290d7a478d4002a480a58`.
- Public and lab health, public app, task catalog, and video-player page returned
  HTTP 200. A forced connection to the Cloudflare address discovered through
  public DNS also returned HTTP 200. The undeclared `/admin` route returned 404.
- Health reports live Nebius Token Factory inference and local container checks.
  This is not a Nebius Sandboxes entitlement or competition-readiness claim.
- The runtime was active with zero restarts and UMask 0077. The frontend was
  healthy, nonprivileged, UID 101:GID 1000, with a read-only root filesystem,
  dropped capabilities, no host port bindings, and only the two intended
  read-only control/media mounts. It has no Docker-socket or credential mounts.
- Five consecutive observed Gatus checks from 01:39 through 01:43 UTC passed.
- Verification used read-only HTTP GET, DNS, selected service/container metadata,
  and PatchProof monitoring lines. It did not create a paid run.

Command and exit code:

```text
python3 research/verification/20260928-live-deployment/final-deployment/verify-deployment.py 3d0ce9d33b2169efec6290d7a478d4002a480a58 release-3d0ce9d-under-load
exit 0
```

The receipt directly in this directory belongs to the earlier release
`7467626bc77b78ffe4698efc09898471b3ab72f1`; it is preserved as historical evidence.
The separately authorized Cloudflare browser POST, peer address, actual repair
failure, and evidence export are preserved in
`../cloudflare-secondary-task/attempt-01/`. A healthy deployment does not imply
that every generated candidate passes its declared checks.

Actual MP4 download, Cloudflare range requests, and browser playback are checked
separately by `verify-video.mjs`; its output is `video-receipt.json`. The earlier
deployment receipt records that the recording was not yet installed at that time.

The hosted recording subsequently passed all ten video checks, exit 0. It is
95.12 seconds and 6,406,420 bytes; the downloaded MP4 matches SHA-256
`c3acffaa8cc3d84af794efdd86f798ccb3abe4572c5fb370ee62a298a9921864`.
The forced Cloudflare connection returned HTTP 206 with the correct first 1,024
bytes. Real Chromium playback advanced past one second on both 1,440-pixel
desktop and 390-pixel mobile viewports, with native controls, readyState 4, zero
page/console errors, and no horizontal overflow. Both players then sought to
10 seconds; the saved screenshots show that position. The mobile screenshot was
also visually inspected.

```text
node research/verification/20260928-live-deployment/final-deployment/verify-video.mjs
exit 0
```

Public player: https://patchproof.andrewmohawk.xyz/demo/

Direct MP4: https://patchproof.andrewmohawk.xyz/demo/patchproof-real-demo.mp4
