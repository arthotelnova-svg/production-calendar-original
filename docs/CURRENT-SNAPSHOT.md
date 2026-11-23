# Current application snapshot

This branch preserves the source of the running preview instance at
https://preview.calendar.agenticengineer.ru/, designated by the owner as the
current primary application version on 2026-11-23.

The deployment was not switched or restarted by this publication. The `main`
branch and the separate calendar.agenticengineer.ru instance are unchanged.

## Provenance

- Source release: `preview-vacation-20261112T180928Z`.
- All 73 source, configuration, documentation and test files were copied
  byte-for-byte from that running release and hash-compared before publication.
- This document is additional publication metadata, not deployed application code.
- Runtime dependencies, build artifacts, environment files, database contents
  and uploaded user files are not part of this snapshot.
- Existing README/deployment documents are retained verbatim; operational paths
  and their historical descriptions are not instructions to change live services.

## Verification

Executed in an isolated source clone using the deployed Node executable and
existing deployed dependencies; no live authentication credentials or database
were supplied to the build/test commands.

- `npm test`: 19 test files passed; 132 tests passed.
- `NEXT_TELEMETRY_DISABLED=1 npm run build`: successful.
- Build warnings: `jose` uses CompressionStream/DecompressionStream APIs that
  Next.js warns are unsupported in the Edge Runtime.
- Snapshot and existing Git history checked against known live service secrets
  and common private-key/token patterns; no matches. This is a scoped scan,
  not a formal security audit.

This publication does not certify phone/VPN reachability or a new authenticated
OAuth round-trip; those are separate runtime checks.
