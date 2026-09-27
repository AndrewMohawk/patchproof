# Private recorded-evidence viewer

The archive opens explicitly selected, terminal product-evidence bundles in the existing task, comparison and evidence screens. It binds only to loopback and cannot create, cancel, resume or replay a run. The normal `make dev` application remains the mock execution surface.

First obtain a reviewed export from the private [evidence operator](../scripts/evidence-operator.ts). Keep the archive configuration and each exported bundle outside the source checkout, in operator-owned directories with mode `0700` and regular files with mode `0600`. Symlinks, hardlinks, URLs and paths inside the checkout are rejected. The viewer never discovers credentials, searches arbitrary directories or accepts browser uploads and paths.

The configuration has exactly these fields; replace the illustrative paths, UUID and digest with the reviewed values:

```json
{
  "schemaVersion": "1.0",
  "kind": "patchproof-evidence-archive",
  "bundles": [
    {
      "path": "/absolute/private/archive/run.json",
      "runId": "<recorded run UUID>",
      "bundleDigest": "sha256:<recorded bundle digest>"
    }
  ]
}
```

`evidenceArchiveConfigDigest` in `apps/api/src/evidence-archive.ts` parses the strict schema and computes the configuration digest. Supply that independently checked digest to start the viewer:

```sh
node scripts/evidence-archive.ts /absolute/private/archive/config.json sha256:<config-digest> 43173
```

The optional port defaults to `43173`. Open the printed loopback URL. The startup response contains a safe archive manifest, no input paths or bundle contents. Ctrl-C closes the listener. This command does not instantiate a coordinator, model adapter or sandbox runner, and it does not open a run journal or budget ledger.

The archive accepts 1–30 distinct run IDs and paths, at most 4 MiB per file and 32 MiB in total. It verifies each exact run ID and bundle digest, evidence schema and derived artifacts, then matches the full fixture and its source/policy digests against the current public development/calibration catalogue. Sealed final fixtures, experiment traces, candidate-only artifacts, unapproved tasks and incomplete runs are rejected. Historical product formats `2.0` and `2.1` retain their original validation rules and bytes; their approved fixture must still match. A changed fixture fails startup rather than silently changing a historical record's description or policy.

Verified evidence, public task metadata and UI assets are copied into private in-memory snapshots. Later changes or deletion of an input, configuration or source file do not change the running archive. Restart with a newly reviewed configuration to load different evidence. Downloads preserve the exact input JSON bytes, including historical commands; the viewer does not rewrite old bundles.

The API serves only `GET /tasks`, `GET /runs`, `GET /runs/:id` and `GET /runs/:id/evidence`, plus fixed UI assets. Mutation routes and event streams reject. The UI hides execution/cancellation controls and labels **recorded live** and **recorded mock** separately. A recorded-live label reflects the source record; integrity verification does not authenticate provider activity, model quality, billing or human review. Unknown usage remains unmeasured. Browser rendering treats patches and logs as plain text.

Replay is a separate operator action. Recorded live evidence needs the current private replay configuration and its digest; the archive does not present the historical bare replay command as sufficient authorization. No viewing action triggers a check, model call, merge, publication or upload. Provider access, real-provider proof and any public deployment remain separate requirements.

Verification uses invented unit bundles only:

```sh
node --test tests/evidence-archive.test.ts
node scripts/verify-evidence-archive.ts
npm run typecheck
```

The browser check covers recorded live and historical mock labels, absent mutation controls, keyboard/mobile behavior, literal patch rendering, exact-byte download and the unchanged mock launch UI using a synthetic HTTP stub. No candidate or provider is executed. Its neutral receipt is written to `.local/verification/evidence-archive-browser.json`; screenshots go to `/tmp/patchproof-evidence-archive-*.png`. The separate reviewer-study surface still uses independently curated neutral packets and answer keys; this archive is not a blinded reviewer exercise or a human usability result.
