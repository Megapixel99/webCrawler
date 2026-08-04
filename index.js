
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const process = require('process');
const models = require('./MongoModels.js');
const moment = require('moment');
const convert = require('./convert.js');
const {
    JSDOM
} = require("jsdom");
const getMeta = require('./meta.js');
const robots = require('./robots.js');

const USER_AGENT = process.env.CRAWLER_USER_AGENT;
const MIN_CRAWL_DELAY_MS = Number.parseInt(process.env.MIN_CRAWL_DELAY_MS, 10) || 5000;
const MAX_CRAWL_DELAY_MS = Number.parseInt(process.env.MAX_CRAWL_DELAY_MS, 10) || 60000;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 10000;

const OUTCOMES = {
  CRAWLED: 'crawled',
  DEFERRED: 'deferred',
  DISALLOWED: 'disallowed',
  FAILED: 'failed',
};

axios.defaults.headers.common['Accept'] = 'text/text,text/html'
axios.defaults.headers.common['User-Agent'] = USER_AGENT

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeURL(result) {
  return Promise.all([
    models.Url.findOne({ Url: result }).exec(),
    models.Entry.findOne({ Url: result }).exec(),
  ]).then((data) => {
    if ((data[0] === null || data[0] === undefined) &&
    (data[1] === null || data[1] === undefined)) {
      return (new models.Url({
        Url: result,
        FoundAt: new Date(moment()),
      }).save());
    }
  })
}

function checkRes(res) {
  if ((res.status >= 200 && res.status <= 299) &&
  res.headers['content-type'].includes("text/html"))
    return true;
  else
    return false;
}

async function processURL(res, url) {
  if (checkRes(res)) {
    let { document } = new JSDOM(res.data, { url }).window;
    let meta = getMeta(document);
    if (meta.robots !== undefined && meta.robots !== null &&
    (meta.robots.toLowerCase().includes("nofollow") ||
    meta.robots.toLowerCase().includes("noindex"))) {
    console.log(`${url} had a nofollow or noindex tag`);
      return Promise.resolve();
    }

    let matches = [...document.querySelectorAll("a")].map((a) => a.href).filter((e) => e.startsWith('http'));
    if (matches?.length > 0) {
      let processUrls = [];
      console.log(`${matches.length} URLs found in ${url}`);
      for (let i = 0; i < matches.length; i++) {
         processUrls.push(writeURL(matches[i]));
      }
      return Promise.all(processUrls);
    } else {
      console.log(`No URLs found in ${url}`);
      return Promise.resolve();
    }
  }
}

function crawlDelayMs(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return MIN_CRAWL_DELAY_MS;
  return Math.min(Math.max(seconds * 1000, MIN_CRAWL_DELAY_MS), MAX_CRAWL_DELAY_MS);
}

async function seedHost(host) {
  try {
    return await models.Host.findOneAndUpdate(
      { host },
      { $setOnInsert: { nextAllowedAt: new Date(0) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
    return models.Host.findOne({ host });
  }
}

async function fetchRobots(origin) {
  try {
    const res = await axios.get(`${origin}/robots.txt`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { Accept: 'text/plain,text/*' },
      validateStatus: (status) => status < 500,
    });
    if (res.status >= 400) return '';
    return typeof res.data === 'string' ? res.data : '';
  } catch (err) {
    console.log(`Unable to fetch robots.txt for ${origin}: ${err.message}`);
    return null;
  }
}

async function nextQueue(url, _pid = 0) {
  console.log("URL being processed: " + url);
  const { host, origin, pathname, search } = new URL(url);
  const path = pathname + search;
  pid = _pid;

  try {
    await sleep(1000);

    const hostRecord = await seedHost(host);
    const now = new Date();
    const claim = await models.Host.findOneAndUpdate(
      { host, nextAllowedAt: { $lte: now } },
      {
        $set: {
          nextAllowedAt: new Date(now.getTime() + crawlDelayMs(hostRecord.crawlDelay)),
          fetchedAt: now,
        },
      },
      { new: true }
    );
    if (!claim) {
      console.log(`${url} deferred, ${host} was fetched too recently`);
      return OUTCOMES.DEFERRED;
    }

    let parsed;
    if (claim.robotsCheckedAt) {
      parsed = robots.parse(claim.robotsTxt, USER_AGENT);
    } else {
      const body = await fetchRobots(origin);
      if (body === null) {
        return OUTCOMES.DEFERRED;
      }
      parsed = robots.parse(body, USER_AGENT);
      const update = { robotsTxt: body, robotsCheckedAt: new Date() };
      if (parsed.crawlDelay !== null) {
        update.crawlDelay = parsed.crawlDelay;
        update.nextAllowedAt = new Date(now.getTime() + crawlDelayMs(parsed.crawlDelay));
      }
      await models.Host.updateOne({ host }, { $set: update });
    }

    if (!robots.isAllowed(parsed.rules, path)) {
      console.log(`${url} is disallowed by robots.txt`);
      return OUTCOMES.DISALLOWED;
    }

    const res = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS });
    await convert(res, url, _pid);
    await processURL(res, url);
    return OUTCOMES.CRAWLED;
  } catch (err) {
    console.error(`URL: ${url} failed: ${err.message}`);
    return OUTCOMES.FAILED;
  }
}

module.exports = nextQueue;
module.exports.OUTCOMES = OUTCOMES;
