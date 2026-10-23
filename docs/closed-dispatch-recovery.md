# Closed-dispatch recovery

`historical-20261020-closed-dispatch-v1` recognizes one immutable historical
dispatch whose provider billing is still unknown. It is not a general retry or
settlement mechanism.

The operator must opt in through `closedDispatchRecoveryPolicy`. Recovery is
accepted only from a fresh, quiescent ledger checkpoint and only when every
pinned case field, approval digest, reservation, source/config/evidence digest,
token bound, fee assumption, and dispatch count matches. The original hold and
unknown actual cost remain unchanged. The episode can never be dispatched again.

Coverage is appended atomically to the ledger and fails closed on races, storage
errors, later evidence, approval changes, unrelated writes, active reservations,
overruns, or operator freezes. Increasing the approved cap can carry coverage
only while paused and only with the prior event sequence and proof digest; the
carry cannot alter the historical case, stage allocation, limits, expiry, or
credits.

Portable tests use synthetic ledgers. Exact private artifact authenticity is a
separate operator check:

```sh
node scripts/verify-private-integration-artifacts.ts \
  /absolute/private/pricing-evidence.json \
  /absolute/private/repair-evidence.json
```

The verifier requires both artifacts and checks their pinned identities without
copying them into the repository.
