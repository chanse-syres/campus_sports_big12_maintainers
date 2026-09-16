# Big 12 maintainers

One multi-sport maintainer per school for Campus Sports HQ. This public repository contains collectors and a versioned data contract. The frontend connects to validated public snapshots; no private application checkout, database credential, API key, or deployment token is needed.

## Run

Requires Node.js 24.

```sh
npm ci --ignore-scripts
npm test
npm run check
node teams/arizona/maintainer.mjs
# Or collect all 16 schools:
npm run maintain -- --all
npm run validate
# Validate a complete publication without writing to GitHub:
node scripts/publish.mjs --dry-run
```

Every `teams/<school>/maintainer.mjs` runs football, men's basketball, women's basketball, and baseball together. Colorado and Iowa State baseball are explicitly `unsupported`. A school-only run emits a partial manifest for local work; publication requires exactly all 16 schools from one generation.

## Data and coverage

| Collection | Source | Coverage |
| --- | --- | --- |
| News | Official athletics plus reviewed national and team-focused publisher feeds | School/sport-classified article metadata, original links, publication dates, and available photos; deduplicated rolling archive of up to 1,000 stories per sport |
| Schedule/results | ESPN public team data | Source-provided season, dates, opponents, scores and game status |
| Roster | ESPN public team data | Public athlete name, position, jersey, class, profile and headshot; no birthdays, contact information or private records |
| Recruiting announcements | Official news | Recent headlines matching signing/recruiting language, clearly separate from player records |
| Recruiting board | 247Sports (football/men's basketball), ESPN HoopGurlz (women's basketball), Perfect Game (baseball) | Source-reported commitments for the active recruiting cycle, with profile information and ratings/rankings only when provided |
| Recruiting offers | 247Sports public offer lists | Football and men's basketball historical offers, separate from commitments; an offer does not establish current availability |

Women's basketball and baseball offer lists report `unavailable` with `provider-does-not-cover-offers`. An ESPN empty commitment listing uses `empty` with `provider-has-no-commitment-records`; it does not verify a zero-player class. Display the mapper's coverage label, and preserve any prior nonempty board as stale. All collections expose their actual coverage and source health. This repository does not claim a complete recruiting offer ledger, transfer portal database, historical archive, or real-time scoreboard.

News discovery uses a reviewed publisher catalog rather than a promise to index every page on the internet. New valid stories publish into their school and sport's `news.records` automatically; ambiguous or unrelated stories are rejected. Captured metadata remains when a publisher's RSS window rotates, up to the newest 1,000 articles per sport. Each source's health remains visible in `news.sources`, and each article retains `discoverySourceUrl`.

The catalog includes Sports Illustrated's 16 school feeds, ESPN, NCAA.com, CBS Sports, Heartland College Sports, and ten team-focused/student publications. Shared feeds are fetched once per complete run. Missing photos may be filled from the original article's verified public image metadata, with at most three article fetches per sport per school per run. No article bodies are republished.

These provider endpoints and serialized page formats are upstream dependencies, not guaranteed APIs. A changed, blocked, incomplete or empty response cannot silently erase the last successful collection. `generatedAt` records the collection run; `lastSuccessAt` and the original article date separately identify verified data freshness. A successful fetch can still yield a prior season's roster or schedule; consumers must display `season`.

## Connect the frontend

Start with [the builder handoff](docs/BUILDER_HANDOFF.md), [JSON Schema](schemas/snapshot.schema.json), and the [tested server-side adapter](examples/frontend-adapter.mjs).

- Manifest: `https://raw.githubusercontent.com/chanse-syres/campus_sports_big12_maintainers/data/v2/manifest.json`
- School: `https://raw.githubusercontent.com/chanse-syres/campus_sports_big12_maintainers/data/v2/teams/arizona.json`
- Source code stays on `main`; only the 17 validated JSON files are published to `data`.

Use schema version 2 and the server-side `toFrontendTeam` mapper for all six collections. It maps `womens-basketball` to the existing frontend's `womensBasketball` key and keeps `{ records, health }` together. Render `health.status`, `health.stale`, `health.season`, and `health.reason`; preserve nullable ratings and source-specific ranking context. Do not equate an unavailable feed with an empty roster or recruiting class.

```js
import { loadTeamSnapshot, toFrontendTeam } from './examples/frontend-adapter.mjs';
const result = await loadTeamSnapshot('arizona', { previousSnapshot: cachedSnapshot });
const team = toFrontendTeam(result.snapshot, { expectedSlug: 'arizona', transportStale: result.stale });
const { records, health } = team.sports.football.recruitingBoard;
```

This is a server integration example; `cachedSnapshot` is your previously validated v2 snapshot or `null`. The handoff includes validation dependencies, record mappings, and the checks needed before declaring a frontend deployment connected.

For a consistent multi-school import, resolve `data` to a commit and read the manifest and files at that commit, then check every SHA-256. Mutable raw URLs may be cached and are not a transactional multi-file API. A single school snapshot is self-contained.

## Automation

The `Maintain Big 12 public data` workflow refreshes every six hours at minute 17. Manual runs default to collecting an artifact only; choose `publish=true` to update public snapshots. Three schools run at once, with sequential bounded requests inside each school. A separate publisher job validates the complete bundle again before one atomic Git ref update.

To preserve last successful data locally, run `node scripts/publish.mjs --download-previous` in a checkout without a `previous` directory, then `npm run maintain -- --all --previous previous`. Network or schema failures are recorded per collection. Workflow source-health checks make unexpected stale/unavailable core datasets visible as failures while retaining the useful snapshot.

GitHub may delay scheduled runs and disables schedules in inactive public repositories after 60 days. Monitor freshness independently in the consumer. This is scheduled batch maintenance, not an uptime guarantee. Standard public GitHub-hosted runner usage is covered by GitHub's public-repository Actions terms; separate hosting, storage and provider limits still apply.

## Security and maintenance

Read [SECURITY.md](SECURITY.md). Dependencies are lockfile-pinned, dependency install scripts are disabled, Actions are pinned to verified commits, and pull requests receive read-only jobs. Dependabot and CodeQL cover dependencies, JavaScript and Actions. Repository settings enforce branch protection and secret controls separately from the code.

Images remain publisher URLs with missing images represented as `null`. No photo licensing rights are granted by this repository. Render source attribution, use a site-owned fallback image when absent, and confirm the intended image use with the publisher. Article bodies are neither stored nor republished.

## Schools

Arizona, Arizona State, Baylor, BYU, Cincinnati, Colorado, Houston, Iowa State, Kansas, Kansas State, Oklahoma State, TCU, Texas Tech, UCF, Utah, West Virginia. [Official Big 12 membership](https://big12sports.com/news/2019/7/31/big-12-conference.aspx).
