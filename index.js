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

axios.defaults.headers.common['Accept'] = 'text/text,text/html'

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

function nextQueue(url, _pid = 0) {
  let { host, origin } = new URL(url);
  const now = new Date();
  console.log("URL being processed: " + url);
  return sleep(1000)
    .then(async () => {
      await models.Host.updateOne(
        { host },
        { $setOnInsert: { nextAllowedAt: new Date(0) } },
        { upsert: true }
      );
      let claim = await models.Host.findOneAndUpdate(
        { host, nextAllowedAt: { $lte: now } },
        { $set: { nextAllowedAt: new Date(now.getTime() + 5000), fetchedAt: now } },
        { new: true }
      )
      if (!claim) return;
      pid = _pid;
      if (!claim.robotsTxt) {
        await axios.get(`${origin}/robots.txt`)
          .then((res) => res.data)
          .then((robotsTxt) => models.Host.updateOne(
            { host },
            { robotsTxt },
            { upsert: true }
          ))
          .catch((err) => {
            if (err?.response?.status !== 404) {
              throw err;
            }
          })
      }
      let res = await axios.get(url);
      await convert(res, url, claim, _pid);
      await processURL(res, url);
    })
    .catch((err) => {
      console.error("URL: " + url + " failed");
      return sleep(1000);
    })
}

module.exports = nextQueue;
