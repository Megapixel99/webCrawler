# webCrawler

[![test](https://github.com/Megapixel99/webCrawler/actions/workflows/test.yml/badge.svg)](https://github.com/Megapixel99/webCrawler/actions/workflows/test.yml)

A small **web crawler and search engine**, written from scratch in Node.js to
learn how crawling, indexing, and relevance ranking actually work under the
hood. It crawls the open web, builds a **hand-written inverted index** in
MongoDB, and ranks results with a **hand-implemented BM25** scorer — no search
library.

> Built as a learning project. The goal was to understand the pieces of a search
> engine by implementing each one myself, not to compete with a production
> engine. See [Limitations](#limitations).

**Write-up:** [Rate Limiting a Crawler Across Node Cluster
Workers](https://sethwheeler.dev/blog/crawler-rate-limiter/) — the politeness
limiter took three attempts, and the first two enforced a perfectly correct
delay while the crawled host received a hundred simultaneous requests.

---

## How it works

```
 seed URLs
    │
    ▼
┌────────────┐   fetch + parse    ┌─────────────┐   tokenize + count   ┌──────────────┐
│  crawler   │ ─────────────────▶ │   convert   │ ───────────────────▶ │  inverted    │
│ (manager)  │   extract links    │  (a page)   │   term → postings    │   index      │
└────────────┘        │           └─────────────┘                      └──────────────┘
    ▲                 │                                                        │
    │ new URLs        ▼                                                        │  BM25
    └──────────  URL frontier (MongoDB)                                        ▼
                                                                        ┌──────────────┐
                                                query "cats climbing" ─▶│   search.js  │─▶ ranked results
                                                                        └──────────────┘
```

1. **Crawl** — `manager.js` runs a master/worker pool (Node's `cluster`),
   scaling workers to available memory. Each worker pulls a URL from the
   MongoDB frontier, fetches it (`axios`), and parses it (`jsdom`).
2. **Extract links** — `index.js` reads `<a href>` elements, resolves relative
   URLs to absolute (via the page's base URL), honors `noindex`/`nofollow`
   robots meta directives, and pushes newly-discovered URLs back onto the
   frontier.
3. **Index the page** — `convert.js` extracts the title, description, and body
   text, stores an `Entry`, tokenizes the text, and updates the inverted index:
   for each unique term it appends a posting `{ docId, tf, len }` and bumps the
   term's document frequency `df`.
4. **Search** — `search.js` scores documents with **BM25** over the inverted
   index and returns the top matches. `server.js` serves a small web UI and a
   JSON search API.

---

## Architecture

| File | Responsibility |
|------|----------------|
| `manager.js` | Crawl orchestrator — `cluster` master/worker pool, pulls the URL frontier, spawns workers |
| `index.js` | Per-URL worker: fetch, extract & queue links (robots-meta aware), hand off to `convert` |
| `convert.js` | Fetch a page, extract text/metadata, store an `Entry`, and update the inverted index |
| `robots.js` | Hand-written `robots.txt` parser + path matcher (`Disallow`/`Allow`/`Crawl-delay`) |
| `tokenizer.js` | Shared tokenizer used by **both** indexing and search (must be identical on both sides) |
| `search.js` | BM25 ranking over the inverted index |
| `MongoModels.js` | Mongoose schemas (below) |
| `server.js` / `Router.js` | Express search API + serves the client |
| `client/` | Search UI (`home.html`, `search.html`, CSS/JS) |
| `databaseConnect.js` | MongoDB connection |
| `deleteDups.js` | Duplicate-URL cleanup utility |
| `meta.js` | `<meta>` tag / canonical-link extraction |
| `Dockerfile`, `buildAndRun.sh`, `transfer.sh`, `run.sh` | Container build + deploy helpers |

### Data model

- **`Url`** `{ Url, FoundAt }` — the crawl frontier (URLs waiting to be visited).
- **`Host`** `{ host (unique), robotsTxt, robotsCheckedAt, crawlDelay, fetchedAt, nextAllowedAt }` — per-host politeness state, shared across cluster workers. `nextAllowedAt` is the rate-limit slot: a worker claims it with an atomic `findOneAndUpdate` before making any request.
- **`Entry`** `{ Url, Title, Description, Words[], Length, Clicks, FoundAt }` — an indexed page. `Length` is the token count, used by BM25.
- **`IndexTerm`** `{ term (unique, indexed), df, postings: [{ docId, tf, len }] }` — the **inverted index**: each term maps to the documents that contain it, with per-document term frequency and document length.
- **`InvalidEntry`** — pages that had a title but no usable description.

---

## Search: BM25

Documents are ranked by BM25 over the terms in the query:

```
score(D, Q) = Σ  IDF(t) · ( tf · (k1 + 1) ) / ( tf + k1 · (1 − b + b · |D| / avgdl) )
             t∈Q

IDF(t) = ln( (N − df + 0.5) / (df + 0.5) + 1 )

k1 = 1.2,  b = 0.75
```

- `tf` — term frequency in the document (from the posting)
- `df` — number of documents containing the term (on the `IndexTerm`)
- `N` — total documents in the index
- `|D|` — document length; `avgdl` — average document length across the corpus
- The `+1` inside the `IDF` log keeps it non-negative (the Lucene variant), so
  very common terms can't drag scores negative.

Query terms are run through the same tokenizer as the documents, each term's
postings are looked up and scored, and the summed per-document scores are sorted
descending.

---

## Getting started

**Prerequisites:** Node.js 16+ and a MongoDB instance.

```bash
# 1. install
npm ci        # or: npm install

# 2. configure the database connection (see note below)
export MONGO_URI="mongodb://<user>:<pass>@<host>:27017/<db>"

# 3. (optional) set seed URLs — edit the `initURLs` array in manager.js

# 4. start crawling
npm start                     # runs manager.js

# 5. in another shell, start the search server
node server.js                # Express on http://localhost:3000
```

Then open **http://localhost:3000** and search.

> **Configuration note:** `databaseConnect.js` should read the connection
> string from `process.env.MONGO_URI`. Do **not** commit real credentials to the
> repo.

### Tests

```bash
npm test
```

`test/robots.test.js` covers the `robots.txt` parser and path matcher — no
database or network needed.

`test/politeness.test.js` is an integration suite: it runs local HTTP servers
standing in for crawled hosts and asserts on **what those servers actually
received**, since a rate limiter that reports "deferred" while still sending the
request is as rude as no rate limiter at all. It covers `Disallow` enforcement,
robots.txt caching, `Crawl-delay`, failing closed on an unreachable robots.txt,
and the atomic claim under six concurrent workers.

It needs a MongoDB instance and skips itself when none is reachable, so
`npm test` works without one. Point it somewhere specific with:

```bash
TEST_MONGO_URI=mongodb://127.0.0.1:27017/webcrawler_integration_test npm test
```

### Docker

```bash
docker build -t webcrawler .
docker run --restart=on-failure -d webcrawler   # runs the crawler
```

`buildAndRun.sh` and `transfer.sh` are convenience scripts for building and
deploying to a remote host.

---

## Limitations

This is a learning project, and the scope is deliberately bounded:

- **Politeness:** honors `robots.txt` (`Disallow` / `Allow` / `Crawl-delay`) and
  `noindex` / `nofollow` / `noarchive` robots *meta* tags, and rate-limits per
  host. Rules are matched per-path with the usual longest-match-wins precedence,
  but there is no support for `Sitemap:` directives, and robots.txt is fetched
  once per host and never re-checked.
- **Tokenizer:** lowercases, splits on non-alphanumerics, drops empties — but no
  stemming, no stopword removal, and no phrase/positional queries.
- **Indexed text:** title + description (meta description or the first block of
  body text), not the full page body.
- **Crawl model:** multi-process on a single machine via `cluster` (not
  distributed across hosts); MongoDB is the shared frontier and store.
- **Freshness:** each URL is indexed once; there is no re-crawl or staleness
  handling yet.

## Possible improvements

- Re-check `robots.txt` periodically instead of caching it forever per host
- Stemming, stopword filtering, and positional postings for phrase queries
- Index full body text with field weighting (title vs. body)
- Incremental re-crawl / freshness
- Result snippets with query-term highlighting and pagination
- Read all secrets from environment variables

---

## Tech stack

Node.js · `cluster` · Express · MongoDB (Mongoose) · jsdom · axios · html-to-text · Docker

---

*Built by Seth Wheeler as a from-scratch study of crawling, inverted indexes, and BM25 ranking.*
