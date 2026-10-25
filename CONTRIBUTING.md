# Contributing to Homeroom

Thanks for your interest in Homeroom! This is a personal hobby project built for dedicated hockey watching on a local home network. While contributions are welcome, please keep in mind that Homeroom is focused strictly on hockey and local-first operation.

## Principles & Scope

1. **Local-first and personal**: Homeroom runs on your LAN with no accounts, no billing, no cloud telemetry, and no third-party tracking.
2. **Purely hockey**: Feeds are limited to supported hockey leagues (NHL, AHL, ESPN international hockey). We do not plan to support non-hockey sports.
3. **No proprietary assets**: Do not submit proprietary goal horn audio files, team trademarks, or copyrighted media.
4. **Strict TypeScript & Test coverage**: All code must compile cleanly under strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) and include Vitest test coverage where appropriate.

## Development Setup

Requirements:
- Node.js 22+
- npm 10+
- (Optional) Docker for containerized runs

### Server

```bash
cd server
npm install
npm test
npm run typecheck
npm run lint
```

### Web

```bash
cd web
npm install
npm test
npm run typecheck
npm run build
```

## Pull Request Guidelines

1. **Commit Messages**: Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`).
2. **Quality Gates**: Ensure both `server` and `web` pass typecheck, linting, and tests before submitting a PR.
3. **No Secrets or Credentials**: Ensure no personal tokens, IP addresses, or secrets are committed.
