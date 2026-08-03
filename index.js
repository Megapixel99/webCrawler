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

function callUrlBackup(url) {
  return axios.get(url, {
    timeout: 5000
  }).then((res) => {
    if (checkRes(res)) {
      return processURL(res, url);
    }
  }).catch((err) => {
    console.error(err);
    console.log(`Unable to call ${url}`);
  });
}

function callUrl(url) {
  return axios({
    method: "get",
    url: url
  }).then((res) => {
    if (checkRes(res)) {
      return processURL(res, url);
    }
  }).catch((err) => {
    console.log(`Unable to call ${url}, trying again`);
    return callUrlBackup(url);
  });
}

function nextQueue(url, _pid = 0) {
  console.log("URL being processed: " + url);
  return new Promise(async function(resolve) {
    await sleep(1000);
    pid = _pid;
    await callUrl(url);
    await convert(url, _pid);
    resolve();
  });
}

module.exports = nextQueue;
