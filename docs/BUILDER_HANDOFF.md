# Big 12 maintainer integration

This repository produces public, validated JSON for all 16 Big 12 schools. Each
school has one maintainer entry point covering football, men's basketball,
women's basketball, and baseball. Schools without baseball publish an explicit
unsupported status. The frontend and its private backend remain separate.

Schema version 2 covers news, rosters, schedules, recruiting commitments,
recruiting offers, and official recruiting announcements. Check the published
manifest and each dataset's status before enabling a view: implemented adapters
do not establish successful cloud publication or current upstream coverage.
Announcements remain separate headline matches, not structured athlete records.

## Public data locations

The publisher writes to the `data` branch, independently of source code:

- Manifest: `https://raw.githubusercontent.com/chanse-syres/campus_sports_big12_maintainers/data/v2/manifest.json`
- Team: `https://raw.githubusercontent.com/chanse-syres/campus_sports_big12_maintainers/data/v2/teams/{schoolSlug}.json`

The URLs become available after the first successful publication. No GitHub
token, API key, database credential, or maintainer write permission belongs in
the frontend. Fetch public snapshots from your server and cache validated data.
The example reader fixes the repository URL and permits only known school slugs;
do not replace it with an arbitrary URL supplied by a browser request.

School slugs are `arizona`, `arizona-state`, `baylor`, `byu`, `cincinnati`,
`colorado`, `houston`, `iowa-state`, `kansas`, `kansas-state`, `oklahoma-state`,
`tcu`, `texas-tech`, `ucf`, `utah`, and `west-virginia`.

## Snapshot contract

A team snapshot has `schemaVersion: 2`, `conference: "big12"`,
`school: { slug, name, athleticsUrl }`, an ISO `generatedAt`, and `sports`.
The sport keys are `football`, `basketball`, `womens-basketball`, and `baseball`.
Validate the complete response with `validateSnapshot(snapshot, expectedSlug)`
from `src/validate.mjs` before using it. Reject an unexpected schema or school.

Each sport contains `sponsored` and six datasets: `news`, `schedule`, `roster`,
`recruitingAnnouncements`, `recruitingBoard`, and `recruitingOffers`.
Each dataset includes:

| Field | Meaning |
| --- | --- |
| `status` | `ok`, `empty`, `stale`, `unavailable`, or `unsupported` |
| `lastAttemptAt` | ISO time of the latest collection attempt |
| `lastSuccessAt` | ISO time of the most recent successful collection, or `null` |
| `sourceUrl` | HTTPS upstream source, or `null` |
| `season` | Source-reported season string, or `null` |
| `reason` | Coverage/failure explanation, or `null` |
| `records` | Dataset-specific records |

`ok` and `empty` describe a successful source response. `stale` preserves the
last successful records after a source failure; show their age and a stale
notice. `unavailable` means no usable records are available. `unsupported`
means the dataset/program is not supported. Do not render those last two states
as a confirmed empty roster, schedule, or recruiting class.

Also check elapsed time. A snapshot and its `lastSuccessAt` values can become old
even while their recorded status remains `ok`. The example uses 48 hours as a
maximum age and flags implausibly future timestamps. A fetch failure preserves
a caller-provided, validated prior snapshot and marks it stale; it never marks
the retained records as freshly collected. Use a durable server cache if your
deployment is stateless. A cache with no valid snapshot should show unavailable.

## Record types and mapping

**News** combines official athletics and reviewed national/team-focused publisher feeds. It classifies stories by school and sport, canonicalizes tracking URLs, deduplicates repeated URLs/headlines, and retains captured metadata as publisher feed windows rotate (latest 1,000 stories per sport). It does not claim exhaustive coverage of every page on the web. Records contain `id`, `title`, `url`, `discoverySourceUrl`, `publisher`, `publishedAt`,
`publishedAtPrecision`, `imageUrl`, and `imageAlt`. Dates and images can be `null`.
The news dataset also has `sources`, an array of source-level status, URL, attempt/success timestamps, reason, and archived record count. The frontend mapper preserves it in `news.health.sources`. One failed configured publisher marks combined news stale without hiding healthy publishers' new articles. A source success verifies a feed retrieval, not a re-fetch of every archived article.

Precision is `day`, `instant`, or `unknown`. A day-only date is represented as
midnight UTC for sorting; this does not establish a precise publication time.
Article bodies and
summaries are not republished. Keep the source link and attribution visible.
The example adapter supplies an empty `summary` for existing components that
require that string.

The existing Campus Sports HQ news view can consume these fields:

| Maintainer field | Frontend field |
| --- | --- |
| `school.slug` | `schoolId` |
| `school.name` | `schoolLabel` |
| `football`, `basketball`, `baseball` | same internal sport key |
| `womens-basketball` | `womensBasketball` |
| Record `id`, `title`, `publisher`, `publishedAt` | same field |
| Record `publishedAtPrecision` | retain as metadata for date formatting |
| Record `url` | both `url` and `href` |
| Record `imageUrl`, `imageAlt` | same field when present |
| No summary | `summary: ""` |

Identity within a collection is `(schoolId, sport, id)`; keep the collection name
in keys when combining different collections. Filter school and sport before pagination.
Sort by publication date, never by collection time. Records with `publishedAt:
null` cannot safely enter a dated `SiteNewsArticle` feed: the example omits them
and returns `omittedUndatedCount` in health metadata. A separate undated view can
display them with an honest label. Never fill a missing publication date with
`generatedAt`, the current time, or a previous article's date. Add the precision
field to the frontend article type and format `day` records as calendar dates
in UTC, not relative hours or local publication times.

**Schedules** contain `id`, `date`, `name`, `status`, `venue`, `homeAway`,
`opponent`, `teamScore`, `opponentScore`, and `url`. **Rosters** contain `id`,
`name`, `position`, `jersey`, `year`, `imageUrl`, and `url`. Preserve missing
values; roster year does not establish remaining eligibility, and roster
membership does not establish scholarship or NIL status. Generic team pages
need components or adapters for these datasets rather than treating official
resource links as populated records.

**Recruiting announcements** use the news shape. They are selected by a signing
headline heuristic, not confirmed structured athlete records. A match can be
incomplete or unrelated to a high school recruiting class. Label this section
"Official recruiting announcements" and retain the source; do not infer player
commitments, ratings, rankings, class years, transfer status, or decommitments.

**Recruiting boards** use 247Sports for football and men's and women's basketball,
and Perfect Game for baseball. These are
source-reported commitment records, not every offered or interested prospect.
Use `season` and each record's `classYear` rather than assuming the current year.
The cycle changes to the following calendar year in March and retains that class
through the next February. This convention is explicit in `recruitingCycle` and
can be changed when the site's recruiting-year selector needs multiple classes.

Board and offer records contain `id`, `name`, `classYear`, nullable `position`,
`status`, `schoolId`, `sport`, `sourceUrl`, and ISO `updatedAt`. Profile fields
`profileUrl`, `imageUrl`, `schoolName`, and `hometown` are nullable. Rating fields
`rating`, `ratingSystem`, and `stars` and ranking fields `nationalRank`,
`positionRank`, `stateRank`, `rankingState`, and `rankingGroup` are also nullable.
Keep the provider's rating system and ranking group/state beside the value;
do not compare unlabeled scales or treat a missing rank as zero. The 247Sports
rating is on its reported 0–100 scale when present; do not substitute a decimal
composite score. No missing rating, rank, photo, or measurement is fabricated.
`updatedAt` is verification time, not commitment date. `schoolName` is the provider-displayed prior institution, which may be a high school, prep school, or junior college. Identical duplicated offer rows are collapsed only after verifying every source row and section count; the reason `provider-duplicate-records-deduplicated:N` records how many duplicate rows were removed. Conflicting duplicates fail the collection.

The mapper preserves lowercase `status` and adds `statusLabel`, `lastUpdated`,
`scope`, `href`, and `sources` for frontend use. Provider attribution is retained
as 247Sports or Perfect Game. Existing recruit components must
accept nullable values rather than requiring a made-up star count or position.

**Recruiting offers** are a separate football/men's and women's basketball collection. An
`offered` record means a historically reported offer from this school, even if
the player committed elsewhere. Display the mapper's "Historical offer" label;
do not infer that the player remains uncommitted, interested, or available.
Baseball offers are `unavailable` with
`provider-does-not-cover-offers`. Official recruiting announcements still run
for all sponsored sports.

Women's basketball uses 247Sports public lists; the ESPN HoopGurlz website
returned HTTP 202 from GitHub runners. Women's provider coverage is incomplete,
including nonempty lists (`provider-reported-records-coverage-incomplete`).
An explicit women's listing with no commitment records produces `status: "empty"`
with `reason: "provider-has-no-commitment-records"` and a successful fetch time.
This verifies the provider's empty listing, not a zero-player recruiting class.
Display the mapper's `health.coverageLabel`: "No commitment records listed by
provider; class size unknown". If a previous snapshot contains commitments, the
maintainer retains them as stale instead of erasing them on that unconfirmed
empty listing. On source blocking, also retain the prior successful collection
with its stale status and timestamps. Never turn missing provider coverage into
a verified empty recruiting class. Empty women's offer lists similarly use
`provider-has-no-offer-records`, preserve prior same-source records as stale,
and carry the mapper label "No offer records listed by provider; coverage incomplete".
Nonempty women's collections carry "Provider-reported records; coverage incomplete".

Existing school-scoped recruiting loaders also need the Big 12 schools
registered before they can accept those scopes. Connecting the news reader alone
does not enable recruiting boards. Validate each board's school/sport scope and
adapt the versioned records before handing them to existing UI components.

## Connection steps

1. Import the adapter from a reviewed commit, or copy `examples/frontend-adapter.mjs`
   together with `src/validate.mjs`, `src/schema.mjs`, `src/config.mjs`, and
   `src/normalize.mjs`, preserving their relative imports and installing their
   declared dependencies. Keep this code on the server, the public base URL
   fixed, and the validation boundary intact. Use v2 snapshots and cache keys;
   an old v1 snapshot is not a valid v2 fallback.
2. Load each required school snapshot server-side. Persist a last valid snapshot
   for transport failures; retain `transportStatus`, `stale`, and dataset health.
3. Call `toFrontendTeam(snapshot, { expectedSlug, transportStale: result.stale })`.
   Read `team.sports[sport][collection].records` and `.health` together. This maps
   all six collections, adds school/sport scope to every record, and maps the
   women's sport key to `womensBasketball`. Health retains status, source, season,
   reason, attempt/success times, age-derived stale state, and record counts.
4. Add news via the optional `toSiteNews` compatibility helper, and register Big 12
   scopes in recruiting loaders. Replace or invalidate any catalog cached at
   process startup. Render coverage and season beside every collection; the
   frontend must not hide health when it displays retained records.
5. Test a dated story, a missing photo, an undated story, a stale source, an
   unavailable source, an unsupported baseball program, and a fetch failure.

```js
import { loadTeamSnapshot, toFrontendTeam } from './frontend-adapter.mjs';

// Run server-side; priorSnapshot comes from your validated durable cache.
const result = await loadTeamSnapshot('arizona', { previousSnapshot: priorSnapshot });
const team = toFrontendTeam(result.snapshot, {
  expectedSlug: 'arizona',
  transportStale: result.stale,
});
const { records: commits, health } = team.sports.football.recruitingBoard;
const offers = team.sports.football.recruitingOffers;
const women = team.sports.womensBasketball;
// Send only the required scoped records and their health fields to the page.
```

## Rendering and operational security

Treat every upstream string as untrusted data. Render titles/names as text using
your framework's escaping, never raw HTML. Restrict links and images to HTTPS
as the validator requires. If you use an image optimizer/proxy, maintain a
reviewed hostname allowlist and do not accept arbitrary remote image fetches.
Use a text/logo placeholder when an image is absent; do not invent a source photo.

The example refuses redirects, bounds response size and time, and rejects a
different school. Keep those limits when adapting it. A successful HTTP response
is insufficient without schema and scope validation. Never embed write tokens,
private application code, raw HTML, or private review data into this repository,
its public logs, or its outputs. This connection needs public read access only.

Before calling integration complete, verify a successful public workflow,
published snapshots, the frontend deployment, and actual page freshness
separately. A green maintainer run alone does not prove the frontend updated.
