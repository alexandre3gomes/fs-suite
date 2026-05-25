# Contributing to FS Suite

Thanks for your interest in FS Suite. This document describes how to
report issues, suggest features, and submit code changes. Whether you
are a virtual pilot looking to fix a typo or a developer extending the
flight-planning engine, contributions of all sizes are welcome.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Reporting bugs](#reporting-bugs)
- [Suggesting enhancements](#suggesting-enhancements)
- [Translations](#translations)
- [Development setup](#development-setup)
- [Pull-request process](#pull-request-process)
- [Coding standards](#coding-standards)
- [Commit message convention](#commit-message-convention)
- [Aviation conformance](#aviation-conformance)
- [License of contributions](#license-of-contributions)

## Code of conduct

Be kind, be precise, be patient. We expect contributors to behave
respectfully toward each other in issues, pull requests, and any other
project channel. Harassment, personal attacks, and discriminatory
language will not be tolerated.

## Ways to contribute

- Report a bug you found while planning a flight.
- Suggest a new feature or improvement.
- Translate the user interface or documentation.
- Improve documentation, tutorials, or the website copy.
- Submit code: fix a bug, implement a feature, refactor for clarity,
  or improve test coverage.

You do not need to discuss small fixes (typos, broken links, doc
clarifications) before opening a PR. For anything larger, please open
an issue first so we can align on scope.

## Reporting bugs

Search the [issue tracker](https://github.com/alexandre3gomes/fs-suite/issues)
first. If your bug is not already reported, open a new issue with:

- A clear, descriptive title.
- The expected behavior vs. what actually happened.
- Steps to reproduce, ideally with a flight plan you can share (origin,
  destination, aircraft, etc.).
- Browser and OS, and whether you are on `fs-suite.com` or a local
  build.
- Screenshots or console errors if relevant.

Security issues should not be filed in the public tracker. Instead,
email the maintainer (see the GitHub profile) so we can coordinate a
fix before disclosure.

## Suggesting enhancements

Open an issue with the **enhancement** label. Describe the use case
("as a pilot doing X, I would like Y so that Z") before jumping into
implementation details. Real-world aviation grounding is especially
welcome — references to ICAO docs, AIP sections, or AC manuals help
us keep the planning logic faithful.

## Translations

The UI ships with `pt-BR` (Brazilian Portuguese, default) and `en`
(English). Translation files live at:

```
apps/app/src/messages/pt-BR.json
apps/app/src/messages/en.json
```

To add a new language, copy `en.json`, rename it (e.g., `es.json`),
translate the values, and register the locale in
`apps/app/src/i18n/index.ts`.

Keep aviation terminology consistent with how the local authority
publishes it (DECEA for pt-BR, FAA/ICAO for en).

## Development setup

The project is a Turborepo monorepo with `apps/api` (NestJS) and
`apps/app` (Expo). Prerequisites and the full setup live in the
[README](README.md#getting-started). In short:

```bash
git clone https://github.com/alexandre3gomes/fs-suite.git
cd fs-suite
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env  # edit secrets
pnpm --filter @fs-suite/api prisma:migrate
pnpm dev
```

The web app is at `http://localhost:8081` and the API at
`http://localhost:3001`.

## Pull-request process

1. Fork the repository and create a topic branch from `main`:
   `feat/auto-fuel-calc`, `fix/altitude-rounding`, etc.
2. Make focused commits — small, reviewable, with a clear message
   (see below).
3. Run the local checks before pushing:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   ```
4. Update or add tests for the behavior you change.
5. Update documentation when the change is user-facing or alters a
   public contract.
6. Open the pull request against `main`. Fill the description with:
   - What changes and why.
   - Screenshots or short clips for UI changes.
   - A test plan checklist.
7. Address review feedback by pushing new commits (do not amend or
   force-push during review — it makes diffs hard to follow).
8. A maintainer merges the PR once CI is green and review is
   complete.

## Coding standards

- **TypeScript** everywhere; no `any` in new code (use `unknown` and
  narrow).
- **ESLint and Prettier** enforce style — run `pnpm lint` and
  `pnpm format` before pushing.
- **No emoji in source code** unless the user-facing string requires
  it.
- **Comments** explain *why* something is the way it is — not what
  the code does (the code shows that).
- **i18n** all user-facing strings via `react-i18next`. Never
  hardcode text in components.
- **Aviation logic** must be testable — prefer pure functions and
  unit tests over UI-level integration.

## Commit message convention

We follow a simplified Conventional Commits style:

```
<type>: <short summary in present tense, no period>

<optional body explaining the change>
```

`<type>` is one of `feat`, `fix`, `refactor`, `docs`, `chore`, `test`,
`perf`, `build`, `ci`. Examples in the existing history:

```
feat: VFR plan UX bundle — chart overlay, editable altitudes
fix: AI validation accepts altitudeChanges on the plan payload
```

Use the body to capture rationale, trade-offs, or links to references
(ICAO docs, issues). Keep it focused — one logical change per commit.

## Aviation conformance

FS Suite plans simulated flights with real-world rules. When you
change planning logic, ground the change in a published reference
(ICAO Annex, RBAC, AC, AIM, AIP, DECEA circular, etc.) and cite it in
the commit body or PR description. If the change deviates from a
publication, explain why explicitly.

Bug reports that argue against the current behavior should also cite
the rule the code is missing.

## License of contributions

By contributing code, documentation, or translations to FS Suite you
agree that your contributions are licensed under the
[GNU Affero General Public License v3.0](LICENSE) on the same terms
as the rest of the project. You retain the copyright on your work.

If we need to relicense your contribution to ship it under a
commercial license (for the dual-licensing offering), we will reach
out to you to sign a Contributor License Agreement (CLA) first. We
will not relicense your work without explicit consent.
