// Unit tests for the robots.txt parser and path matcher. No database or network
// required — run with `npm test`.

const robots = require('../robots.js');

let pass = 0, fail = 0;

function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
    console.log(`          got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const allow = (txt, path, ua = 'webcrawler') =>
  robots.isAllowed(robots.parse(txt, ua).rules, path);

const basic = `
User-agent: *
Disallow: /private
Allow: /private/public
Crawl-delay: 10

User-agent: googlebot
Disallow: /
`;

console.log('\nbasic rules');
check('plain path allowed', allow(basic, '/index.html'), true);
check('disallowed prefix', allow(basic, '/private/x'), false);
check('longer allow wins', allow(basic, '/private/public/a'), true);
check('crawl-delay parsed', robots.parse(basic, 'webcrawler').crawlDelay, 10);
check('other agent group ignored', allow(basic, '/anything'), true);
check('named agent gets its own group', allow(basic, '/anything', 'googlebot/2.1'), false);

const wild = `
User-agent: *
Disallow: /*.pdf$
Disallow: /tmp/*/cache
Disallow: /search?
`;

console.log('\nwildcards and anchors');
check('$ anchor matches', allow(wild, '/docs/a.pdf'), false);
check('$ anchor respects end', allow(wild, '/docs/a.pdf.html'), true);
check('* mid-pattern', allow(wild, '/tmp/abc/cache'), false);
check('* mid-pattern no match', allow(wild, '/tmp/abc/other'), true);
check('query prefix', allow(wild, '/search?q=1'), false);

console.log('\nempty and total disallow');
check('empty disallow imposes no rule', allow('User-agent: *\nDisallow:', '/anything'), true);
check('disallow all', allow('User-agent: *\nDisallow: /', '/anything'), false);

const messy = 'USER-AGENT: *\r\n# a comment\r\nDISALLOW: /admin  # trailing\r\nnonsense line\r\n';

console.log('\nmalformed input');
check('case-insensitive fields', allow(messy, '/admin/x'), false);
check('comment stripped from value', allow(messy, '/ok'), true);

const grouped = `
User-agent: alpha
User-agent: beta
Disallow: /shared
`;

console.log('\ngrouped user-agents share rules');
check('first agent in group', allow(grouped, '/shared', 'alpha'), false);
check('second agent in group', allow(grouped, '/shared', 'beta'), false);
check('agent outside the group', allow(grouped, '/shared', 'gamma'), true);

console.log('\ndegenerate input');
check('empty file', allow('', '/x'), true);
check('null body', allow(null, '/x'), true);
check('directives before any agent', allow('Disallow: /x', '/x'), true);
check('no crawl-delay', robots.parse('User-agent: *\nDisallow: /a', 'webcrawler').crawlDelay, null);

console.log(`\nrobots parser: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
