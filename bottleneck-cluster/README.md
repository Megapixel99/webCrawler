# Does Bottleneck's rate limit hold across Node `cluster` workers?

This repo's own rate limiter had a bug: each process enforced the delay
independently, so the limiter reported a perfect interval while the host on the
other end received every request at once. The fix was an atomic claim in
MongoDB, and the test that caught it asserts on **what the server received**
rather than on what the limiter reported.

That test generalises. This directory points the same idea at
[Bottleneck](https://github.com/SGrondin/bottleneck), which is the most widely
used rate limiter on npm.

## Result

Bottleneck's default is `datastore: "local"`, and `LocalDatastore` keeps
`_nextRequest` as an instance field. There is no IPC in the library: every
occurrence of "cluster" in its source refers to *Redis* Cluster, not Node's
`cluster` module. So under `cluster` with default options, each worker holds an
independent limiter.

Configured `minTime: 500` (2 requests/second), 6 workers, 6 requests each,
measured at the server:

| arm | min gap | gaps under minTime | rate | limiter's self-report |
|---|---|---|---|---|
| 1 worker, `local` (control) | 487.6 ms | 0/5 | 2.01/s | 498.4 ms |
| **6 workers, `local` (default)** | **0.1 ms** | **30/35** | **14.04/s** | **495.8 ms** |
| 6 workers, `ioredis` (control) | 483.7 ms | 0/35 | 2.00/s | n/a |

The aggregate rate tracks the worker count:

| workers | rate | vs intended |
|---|---|---|
| 1 | 2.01/s | 1.00x |
| 2 | 4.42/s | 2.21x |
| 4 | 9.22/s | 4.61x |
| 6 | 14.04/s | 7.02x |
| 8 | 18.61/s | 9.30x |

**This is not a bug in Bottleneck.** `local` means local, and clustering via
Redis is documented. The finding is that the default configuration degrades
silently under `cluster`: the limiter's own self-report stays at ~497 ms in
every arm, including the ones where the server is being hit 7x too fast.

Both controls matter. The 1-worker arm shows the harness measures spacing
correctly when spacing is happening; the `ioredis` arm shows it passes a
correctly coordinated limiter. Without them, "0.1 ms" is indistinguishable from
a broken test.

## Run it

```bash
npm install
npm run control     # 1 worker, local     -> expect 0 violations
npm test            # 6 workers, local    -> expect ~30/35 violations
docker run -d --rm -p 6379:6379 redis:7-alpine
npm run redis       # 6 workers, ioredis  -> expect 0 violations
```

Any arm: `node harness.js --workers N --datastore local|ioredis --min-time MS --reqs K`

## Method

The primary process starts an HTTP server on a random port and records
`process.hrtime.bigint()` for every arrival. It forks N workers; each builds one
`Bottleneck` with `minTime` and `maxConcurrent: 1`, and schedules K GETs through
it. Each worker also reports the gaps between its *own* job starts, which is the
limiter's view, so the two can be compared in the same run.

Measured on Node v24.11.1, Bottleneck 2.19.5, macOS. Numbers above are from
three repeats of each arm; the `local` 6-worker arm gave 30, 30 and 31
violations out of 35.
