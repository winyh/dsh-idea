# Security

dsh-idea is external-opportunity-first. It can read user-selected public HTTP(S) pages for market, community, review, issue, and competitor signals; local files are optional supplementary evidence and cache.

- External web access is opt-in, read-only, anonymous, and limited to user-provided public HTTP(S) URLs.
- The plugin does not use cookies, account sessions, private credentials, unrestricted crawling, or outreach actions.
- File writes require preview plus explicit confirmation.
- Writes use a version guard to avoid overwriting concurrent edits.
- Paths outside `defaultRoot` are rejected.
- Results avoid echoing raw customer PII where possible.
- Metric failures and missing data are reported rather than treated as zero.

Please report security issues privately to the project owner rather than opening a public issue with sensitive data.
