// Does Bottleneck's rate limit hold across Node `cluster` workers?
//
// Measured from the SERVER's side: a real HTTP server records the arrival time
// of every request, and the verdict is the smallest gap between consecutive
// arrivals. The limiter's own opinion is recorded separately, so the two can be
// compared.
//
//   node harness.js --workers 6 --datastore local --min-time 500 --reqs 5
//
// Arms: 1 worker (control, must pass), N workers local, N workers ioredis.
const cluster = require('node:cluster');
const http = require('node:http');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : process.argv[i + 1]; };
const WORKERS   = Number(arg('workers', 6));
const DATASTORE = arg('datastore', 'local');
const MIN_TIME  = Number(arg('min-time', 500));
const REQS      = Number(arg('reqs', 5));
const REDIS     = arg('redis', '127.0.0.1:6379');

if (cluster.isPrimary) {
  const arrivals = [];
  const server = http.createServer((req, res) => {
    arrivals.push({ t: process.hrtime.bigint(), w: req.headers['x-worker'] });
    res.writeHead(200); res.end('ok');
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const selfReports = [];
    let done = 0;

    for (let i = 0; i < WORKERS; i++) {
      const w = cluster.fork({ PORT: port, WID: String(i), DATASTORE, MIN_TIME, REQS, REDIS });
      w.on('message', (m) => selfReports.push(m));
      w.on('exit', () => {
        if (++done === WORKERS) { server.close(); report(arrivals, selfReports); }
      });
    }
  });

  function report(arrivals, selfReports) {
    arrivals.sort((a, b) => (a.t < b.t ? -1 : 1));
    const gaps = [];
    for (let i = 1; i < arrivals.length; i++) gaps.push(Number(arrivals[i].t - arrivals[i - 1].t) / 1e6);
    const span = Number(arrivals.at(-1).t - arrivals[0].t) / 1e6;
    const violations = gaps.filter((g) => g < MIN_TIME * 0.9).length;

    // What each worker's own limiter thought its spacing was.
    const selfGaps = selfReports.flatMap((r) => r.gaps);
    const selfMin = Math.min(...selfGaps);

    const out = {
      arm: `${WORKERS} worker(s), datastore=${DATASTORE}`,
      configured_min_time_ms: MIN_TIME,
      requests: arrivals.length,
      server_min_gap_ms: +Math.min(...gaps).toFixed(1),
      server_median_gap_ms: +gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)].toFixed(1),
      gaps_under_min_time: `${violations}/${gaps.length}`,
      effective_rate_per_sec: +((arrivals.length - 1) / (span / 1000)).toFixed(2),
      intended_rate_per_sec: +(1000 / MIN_TIME).toFixed(2),
      limiter_self_reported_min_gap_ms: +selfMin.toFixed(1),
    };
    console.log(JSON.stringify(out, null, 2));
  }
} else {
  const Bottleneck = require('bottleneck');
  const opts = { minTime: Number(process.env.MIN_TIME), maxConcurrent: 1 };
  if (process.env.DATASTORE === 'ioredis') {
    const [host, port] = process.env.REDIS.split(':');
    Object.assign(opts, { datastore: 'ioredis', clearDatastore: false,
      clientOptions: { host, port: Number(port) }, id: 'politeness-test' });
  }
  const limiter = new Bottleneck(opts);
  const starts = [];
  const get = () => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: Number(process.env.PORT), path: '/p',
      headers: { 'x-worker': process.env.WID } }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
  });

  (async () => {
    const n = Number(process.env.REQS);
    await Promise.all(Array.from({ length: n }, () => limiter.schedule(() => {
      starts.push(Number(process.hrtime.bigint()) / 1e6);
      return get();
    })));
    const gaps = starts.sort((a, b) => a - b).slice(1).map((t, i) => t - starts[i]);
    process.send({ gaps });
    await limiter.disconnect?.();
    process.exit(0);
  })().catch((e) => { console.error('worker error', e.message); process.exit(1); });
}
