# Security Policy

## Reporting a Vulnerability

Please do not open public issues for suspected vulnerabilities.

Send a private report to the maintainers with:

- Affected version or commit.
- Reproduction steps.
- Impact and affected data, if known.
- Any suggested mitigation.

The maintainers will acknowledge the report, investigate, and coordinate a fix before public disclosure when the issue is confirmed.

## Supported Versions

Until the first stable release, security fixes target the default branch.

## Security Baseline

- Production deployments must set strong `JWT_SECRET`, `SECRETS_MASTER_KEY`, and database credentials.
- Public self-registration is disabled by default and must be explicitly enabled.
- Do not commit `.env` files, API keys, Telegram sessions, database dumps, or production logs.
