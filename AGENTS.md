# AGENTS.md

## OpenSpec

This repo uses OpenSpec 2.1 with project-scope skills in `.agents/skills/`. Use the skills `openspec-propose`, `openspec-apply-change` and `openspec-archive-change` for changes.

This repo follows the spec-checks practice. Load the skill `spec-checks:practice` before you propose, apply or archive a change.

- Base branch: `main`.
- Proposal gate: the repo owner approves the proposal before apply starts.
- Sync gate: the repo owner answers the sync question before archive.
- One session may propose and apply the same change.

## Verify

Run `pnpm check`. It runs the typecheck, the linter, the Prettier check and `spec-checks verify`. Run `pnpm format` to fix what the Prettier check reports. Run `pnpm test` for the unit tests.
