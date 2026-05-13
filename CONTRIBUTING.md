# Contributing

Thank you for helping improve CogniThreat.

## Quick Path

1. Open an issue for bugs, features, or larger refactors before implementing.
2. Fork the repository and create a focused branch.
3. Run the relevant checks before opening a pull request.

```bash
corepack enable
pnpm install
pnpm run build
pnpm test
```

## Development Setup

Use Docker for the full-stack path from this backend repository:

```bash
cp .env.template .env
docker compose up --build
```

For backend-only development, use `pnpm run start:dev` and a reachable PostgreSQL database.

## Pull Request Guidelines

- Keep changes small and reviewable.
- Include tests or a clear manual verification note for behavior changes.
- Keep security-sensitive details out of issues, PR descriptions, commits, and logs.
- Update documentation when commands, environment variables, or deployment behavior changes.

## Code of Conduct

Be respectful, constructive, and security-conscious. The goal is a useful community threat-intelligence platform, not winning arguments.
