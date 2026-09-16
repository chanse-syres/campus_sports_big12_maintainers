# Security policy

Do not disclose credentials or exploitable details in a public issue. Use this repository's GitHub private vulnerability reporting feature when enabled, or the owner's private contact route on GitHub. Supported code is the latest `main` branch and schema version 2.

## Trust boundaries

Upstream HTML and JSON are untrusted. The collector does not execute scripts, revive arbitrary object graphs, follow arbitrary provider-linked APIs, or copy article bodies. It reads only explicit fields, bounds response size/time/record count, and validates school/sport identity and output shape.

External news discovery uses a reviewed direct-publisher RSS/Atom catalog. Feed descriptions are used transiently for classification and are never published as article bodies. Arbitrary links found in feeds do not grant permission to fetch their hosts. Image enrichment fetches only explicitly allowed publisher hosts and checks article canonical identity; image bytes are never downloaded. School-wide feed responses are shared across sports within a run. The rolling news archive is bounded, deduplicated, and retains per-article discovery provenance and per-source health.

Network destinations come from reviewed school configuration and fixed provider endpoints. HTTPS is mandatory. Userinfo, nonstandard ports, IP literals and unlisted hosts are rejected. Every DNS answer must be public unicast; the verified addresses are pinned into the TLS connection lookup. Redirects repeat those controls and are bounded. Authentication, cookies and environment secrets are never attached to upstream requests.

The collector and PR tests have no repository write token. The publisher runs separately on trusted `main` in the canonical repository. It accepts exactly 16 fixed school JSON paths plus their manifest, checks hashes/schema/generation, rejects links and extra files, and writes only the `data` branch through GitHub's API. It does not execute downloaded artifacts or interpolate their data into shell commands. Publication is an atomic, non-forced Git ref update. Fetch and parser failures retain the prior verified collection with its original success timestamp. Final snapshot-schema failures stop publication, leaving the previously published bundle intact.

The public consumer example accepts only school slugs from its allowlist, validates received snapshots and fallback data, bounds downloads, exposes stale states, and sends no credentials. Frontends must render strings as text, not HTML; limit any image proxy to approved publisher/CDN hosts. The collector's URL validation is not permission to proxy every output URL from a privileged network.

## Repository controls

Keep default Actions token permissions read-only and fork workflow approval enabled. Protect `main` against deletion and force pushes; require reviewed pull requests, CODEOWNERS review and passing CI for routine changes. Keep the data branch protected from deletion and force pushes while allowing the publisher's normal fast-forward writes. Prefer short-lived GitHub App/OIDC credentials if private backend writes are added later; do not give this public repository private-repository access or a production database secret.

Pinned actions and exact dependency versions require regular updates. Review Dependabot PRs and CodeQL results. Raw third-party responses, private app files, cookies, credentials, signed URLs, `.env` files and local review queues do not belong in this repository, logs or public artifacts.

The output validator also rejects recognizable credential formats, local user paths, and URLs containing authentication or signature query parameters. These checks supplement closed schemas; they are not a substitute for keeping credentials out of collection jobs. A transient transport/server failure may be retried once; access denials and rate limits are not retried or bypassed.

## Residual risks

Provider content may be wrong or unavailable, and upstream schemas can change. Transport validation cannot establish factual truth. A compromised repository administrator or reviewed maintainer dependency remains a trust risk. GitHub's publisher token is repository-scoped rather than branch-scoped; branch protection and job separation are defense in depth. Public source photos may carry licensing conditions. No audit guarantees that a system is vulnerability-free.
