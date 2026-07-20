---
name: release-checklist
description: Walk the release checklist before tagging and publishing a version
metadata:
  version: "1.0.0"
---

# Release checklist

1. Run the full check + test suite from the repo root.
2. Bump versions across all packages (aligned).
3. Prepend the changelog entry.
4. Tag `vX.Y.Z` and push the tag - CI publishes to npm.
