# Code signing policy

Installers are built only by GitHub Actions from this repository (`.github/workflows/release.yml`), with a
GitHub build-provenance attestation per file and SHA-256 checksums in the release notes. Every release is a
draft first and is published by hand by an approver.

Code signing: not signed yet. An application for free open-source code signing is planned.

## Team

- Committers and reviewers: the maintainers of this repository. Changes from others (pull requests) are reviewed before merge.
- Approvers: the repository owner.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by
the user or the person installing or operating it. See [SECURITY.md](SECURITY.md) for what it reads and stores locally.
