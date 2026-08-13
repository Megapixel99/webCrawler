// Integration tests for crawler politeness: per-host rate limiting under
// concurrent workers, robots.txt enforcement, and caching.
//
// Requires a MongoDB instance. Override the connection with TEST_MONGO_URI.
// If none is reachable, these tests skip rather than fail, so `npm test` still
// works on a machine without MongoDB installed.

// Set config before anything reads process.env at require time. dotenv never
// overrides an already-set variable, so this also guarantees the project's real
// MONGO_URI in .env cannot be picked up here.
process.env.MONGO_URI = process.env.TEST_MONGO_URI ||
  'mongodb://127.0.0.1:27017/webcrawler_integration_test';
process.env.CRAWLER_USER_AGENT = 'testbot';
process.env.MIN_CRAWL_DELAY_MS = '5000';
process.env.REQUEST_TIMEOUT_MS = '3000';

const http = require('http');
const mongoose = require('mongoose');
const models = require('../MongoModels.js');
const nextQueue = require('../index.js');

const OUTCOMES = nextQueue.OUTCOMES;

// The crawler logs heavily; keep the test output readable.
const say = (s) => process.stdout.write(s + '\n');
console.log = () => {};
console.error = () => {};

let pass = 0, fail = 0;

function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
    say(`  ok    ${label}`);
  } else {
    fail++;
    say(`  FAIL  ${label}`);
    say(`          got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const page = (title, body) =>
  `<html><head><title>${title}</title><meta name="description" content="${title} description">` +
  `</head><body>${body}</body></html>`;

// A stand-in for a crawled host that records every request it receives, so we
// can assert on what the server saw rather than only on what the crawler returned.
function makeSite(robotsHandler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/robots.txt') return robotsHandler(res);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page(req.url, '<a href="http://example.com/discovered">link</a>'));
  });
  return { server, hits, port: () => server.address().port };
}

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', r));
const close = (s) => new Promise((r) => s.close(r));
const resetLimit = (host) =>
  models.Host.updateOne({ host }, { $set: { nextAllowedAt: new Date(0) } });

async function connect() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 2000,
    });
    return true;
  } catch (err) {
    return false;
  }
}

async function main() {
  if (!(await connect())) {
    say('\npoliteness: SKIPPED (no MongoDB at ' + process.env.MONGO_URI + ')');
    say('  start one, or set TEST_MONGO_URI, to run these tests');
    process.exit(0);
  }

  // Never run against a real database, whatever the URI ends up being.
  if (!mongoose.connection.name.includes('integration_test')) {
    say(`\nrefusing to run against database "${mongoose.connection.name}"`);
    process.exit(1);
  }

  await Promise.all([
    models.Host.deleteMany({}), models.Url.deleteMany({}),
    models.Entry.deleteMany({}), models.IndexTerm.deleteMany({}),
    models.InvalidEntry.deleteMany({}),
  ]);

  const withRobots = makeSite((res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('User-agent: *\nDisallow: /private\nCrawl-delay: 1\n');
  });
  const noRobots = makeSite((res) => { res.writeHead(404); res.end('nope'); });
  await Promise.all([listen(withRobots.server), listen(noRobots.server)]);

  const hostA = `127.0.0.1:${withRobots.port()}`;
  const hostB = `127.0.0.1:${noRobots.port()}`;
  const urlA = (p) => `http://${hostA}${p}`;
  const urlB = (p) => `http://${hostB}${p}`;

  say('\nallowed path');
  check('outcome is crawled', await nextQueue(urlA('/hello')), OUTCOMES.CRAWLED);
  check('page was fetched', withRobots.hits.includes('/hello'), true);
  check('robots.txt was fetched', withRobots.hits.filter((h) => h === '/robots.txt').length, 1);
  check('entry was indexed', await models.Entry.countDocuments({ Url: urlA('/hello') }), 1);
  check('discovered link queued',
    await models.Url.countDocuments({ Url: 'http://example.com/discovered' }), 1);

  say('\nrate limiting');
  check('immediate retry defers', await nextQueue(urlA('/again')), OUTCOMES.DEFERRED);
  check('no request was made', withRobots.hits.includes('/again'), false);

  say('\ncrawl-delay');
  const docA = await models.Host.findOne({ host: hostA });
  check('crawl-delay parsed and stored', docA.crawlDelay, 1);
  check('floor beats a smaller crawl-delay',
    docA.nextAllowedAt.getTime() - docA.fetchedAt.getTime(), 5000);

  say('\nrobots.txt enforcement');
  await resetLimit(hostA);
  check('disallowed path reported', await nextQueue(urlA('/private/x')), OUTCOMES.DISALLOWED);
  check('disallowed path never requested', withRobots.hits.includes('/private/x'), false);
  check('robots.txt not re-fetched', withRobots.hits.filter((h) => h === '/robots.txt').length, 1);

  say('\nhost with no robots.txt');
  check('404 robots still crawls', await nextQueue(urlB('/page')), OUTCOMES.CRAWLED);
  const docB = await models.Host.findOne({ host: hostB });
  check('empty robots cached', docB.robotsTxt, '');
  check('check recorded', docB.robotsCheckedAt instanceof Date, true);
  await resetLimit(hostB);
  check('second crawl succeeds', await nextQueue(urlB('/page2')), OUTCOMES.CRAWLED);
  check('404 robots not re-requested', noRobots.hits.filter((h) => h === '/robots.txt').length, 1);

  say('\nunreachable host fails closed');
  // Port 1 is reserved and nothing listens there: connection refused.
  check('defers rather than assuming allowed',
    await nextQueue('http://127.0.0.1:1/page'), OUTCOMES.DEFERRED);
  check('no host marked as checked',
    await models.Host.countDocuments({ host: '127.0.0.1:1', robotsCheckedAt: { $ne: null } }), 0);

  say('\nconcurrent workers on a fresh host');
  await models.Host.deleteMany({ host: hostA });
  const racers = await Promise.all(
    Array.from({ length: 6 }, () => nextQueue(urlA('/race'))));
  check('exactly one worker won', racers.filter((r) => r === OUTCOMES.CRAWLED).length, 1);
  check('the rest deferred', racers.filter((r) => r === OUTCOMES.DEFERRED).length, 5);
  check('seed race produced one host doc', await models.Host.countDocuments({ host: hostA }), 1);
  check('only one page request', withRobots.hits.filter((h) => h === '/race').length, 1);

  await Promise.all([close(withRobots.server), close(noRobots.server)]);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  say(`\npoliteness: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  say('HARNESS ERROR: ' + err.stack);
  process.exit(2);
});
