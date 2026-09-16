# Big 12 maintainer integration

This repository produces public, validated JSON for all 16 Big 12 schools. Each
school has one maintainer entry point covering football, men's basketball,
women's basketball, and baseball. Schools without baseball publish an explicit
unsupported status. The frontend and its private backend remain separate.

The connection contract is ready for **news, roster, and schedule snapshots and
their coverage states**. Check the published manifest and each dataset's status
before enabling a view: a working maintainer does not imply every upstream
source returned usable data. Football and men's basketball recruiting boards
cover verified 247Sports commitments for the next signing cycle. Recruiting
announcements are separate headline matches; they must not be used as structured
player recruiting boards.

## Public data locations

The publisher writes to the `data` branch, independently of source code:

- Manifest: `https://raw.githubusercontent.com/chanse-syres/campus_sports_big12_maintainers/data/v1/manifest.json`
- Team: `https://raw.githubusercontent.com/chanse-syres/campus_sports_big12_maintainers/data/v1/teams/{schoolSlug}.json`

The URLs become available after the first successful publication. No GitHub
token, API key, database credential, or maintainer write permission belongs in
the frontend. Fetch public snapshots from your server and cache validated data.
The example reader fixes the repository URL and permits only known school slugs;
do not replace it with an arbitrary URL supplied by a browser request.

School slugs are `arizona`, `arizona-state`, `baylor`, `byu`, `cincinnati`,
`colorado`, `houston`, `iowa-state`, `kansas`, `kansas-state`, `oklahoma-state`,
`tcu`, `texas-tech`, `ucf`, `utah`, and `west-virginia`.

## Snapshot contract

A team snapshot has `schemaVersion: 1`, `conference: "big12"`,
`school: { slug, name, athleticsUrl }`, an ISO `generatedAt`, and `sports`.
The sport keys are `football`, `basketball`, `womens-basketball`, and `baseball`.
Validate the complete response with `validateSnapshot(snapshot, expectedSlug)`
from `src/validate.mjs` before using it. Reject an unexpected schema or school.

Each sport contains `sponsored` and five datasets: `news`, `schedule`, `roster`,
`recruitingAnnouncements`, and `recruitingBoard`.
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

**News** records contain `id`, `title`, `url`, `publisher`, `publishedAt`,
`publishedAtPrecision`, `imageUrl`, and `imageAlt`. Dates and images can be `null`.
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

Identity is `(schoolId, sport, id)`. Filter school and sport before pagination.
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

**Recruiting boards** contain verified 247Sports commitments for football and
men's basketball for the next signing cycle. Coverage is commitments only;
`reason: "verified-commitments-only-offers-not-covered"` identifies this boundary.
The dataset does not represent every offered/interested prospect and provides
no invented ratings, stars, rankings, or offer history. Use `season` and each
record's `classYear` rather than assuming the current calendar year.
The cycle changes to the following calendar year in March and retains that class
through the next February. This convention is explicit in `recruitingCycle` and
can be changed when the site's recruiting-year selector needs multiple classes.

Each board record contains `id`, `name`, `classYear`, nullable `position`,
`status`, `schoolId`, `sport`, `sourceUrl`, and ISO `updatedAt`. The schema permits
`offered`, `committed`, `signed`, `enrolled`, or `unknown` status for future
providers; this pilot's commitments adapter must not be presented as providing
all those categories. Retain the exact source status and provenance. Map the
sport key as above; if integrating an older recruit UI, map lowercase status to
its display label and add `sources: [{ label: "247Sports", url: sourceUrl }]`.
Modify that UI to support absent ratings/stars instead of inserting zeroes or
invented measurements. `updatedAt` is verification time, not commitment date.

Women's basketball and baseball boards are `unavailable` with reason
`player-board-provider-not-configured` until an independent approved provider is implemented.
Official recruiting-announcement coverage still runs for all sponsored sports.
If any board is `unavailable`, do not interpret its empty records as "zero
recruits". On source blocking, retain the prior successful board with its stale
status and timestamps.

Existing school-scoped recruiting loaders also need the Big 12 schools
registered before they can accept those scopes. Connecting the news reader alone
does not enable recruiting boards. Validate each board's school/sport scope and
adapt the versioned records before handing them to existing UI components.

## Connection steps

1. Bring the versioned validation module and `examples/frontend-adapter.mjs` into
   the frontend's server integration, or package/import them from a reviewed
   commit. Keep the public base URL fixed and preserve the validation boundary.
2. Load each required school snapshot server-side. Persist a last valid snapshot
   for transport failures; retain `transportStatus`, `stale`, and dataset health.
3. Call `toSiteNews(snapshot, { transportStale: result.stale })`. Add its `articles`
   to the existing server-side catalog and expose its `health` beside the feed.
   A catalog built once at process startup must be replaced or invalidated on
   refresh; fetching alone will not update an indefinitely cached catalog.
4. Render supported schedule/roster datasets through their own adapters. Show
   unavailable/unsupported/stale states explicitly. Enable recruiting boards
   only for validated source coverage after school-scope registration.
5. Test a dated story, a missing photo, an undated story, a stale source, an
   unavailable source, an unsupported baseball program, and a fetch failure.

```js
import { loadTeamSnapshot, toSiteNews } from './frontend-adapter.mjs';

// Run server-side; priorSnapshot comes from your validated durable cache.
const result = await loadTeamSnapshot('arizona', { previousSnapshot: priorSnapshot });
const { articles, health } = toSiteNews(result.snapshot, {
  transportStale: result.stale,
});
// Send only the scoped articles and the needed health fields to the page.
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
