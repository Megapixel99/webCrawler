const models = require('./MongoModels.js');
const tokenizer = require('./tokenizer.js');
const axios = require('axios');
const moment = require('moment');
const htmlToText = require('html-to-text');
const {
    JSDOM
} = require("jsdom");
const getMeta = require('./meta.js');
let regTitle = new RegExp('<title((.|\n|\r)*)>((.|\n|\r)*)</title>', 'g');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeEntry(url, title, desc) {
  return new Promise(async (resolve, reject) => {
    let words = tokenizer([...desc.split(' '), ...title.split(' ')]);
    let obj = {
      Url: url,
      Title: title,
      Description: desc,
      Words: words,
      Clicks: 0,
      FoundAt: new Date(moment()),
      Length: words?.length,
    };
    models.Entry.findOne({ Url: url }, async (err, _entry) => {
      let entry = _entry;
      if (!err) {
        if (entry == null) {
          entry = await new models.Entry(obj).save();
          const terms = [...new Set(entry.Words)].filter(Boolean);   // unique + no empties
          await Promise.all(terms.map(term =>
            models.IndexTerm.updateOne(
              { term },
              {
                $push: {
                  postings: {
                    docId: entry._id,
                    tf: entry.Words.filter(e => e === term).length,
                    len: entry.Words.length
                  }
                },
                $inc:  { df: 1 }
              },
              { upsert: true },
            )
          ));
        }
      } else {
        console.error(err);
        reject(err);
      }
      resolve();
    });
  });
}

async function writeInvaildEntry(url, title) {
  return new Promise(async (resolve) => {
    let obj = {
      Url: url,
      Title: title,
      Clicks: 0
    };
    models.InvalidEntry.findOne(obj, (err, entry) => {
      if (!err) {
        if (entry == null || entry == undefined) {
          new models.InvalidEntry(obj).save()
        }
      } else {
        console.error(err);
      }
      resolve();
    });
  });
}

function checkRes(res) {
    if ((res.status >= 200 && res.status <= 299) &&
      res.headers['content-type'].includes("text/html"))
        return true;
    else
        return false;
}

async function findRecords(res, url, pid = 0) {
  if (checkRes(res)) {
    let dom = new JSDOM(res.data).window.document;
    let meta = getMeta(dom);
    let archive = true;
    if (meta.robots !== undefined && meta.robots !== null) {
      if (meta.robots.toLowerCase().includes("noindex") || meta.robots.toLowerCase().includes("none")) {
        return;
      }
      archive = meta.robots.toLowerCase().includes("noarchive") || meta.robots.toLowerCase().includes("no archive");
    }
    if (archive) {
      let description = (meta.description || meta['og:description'] ||
        htmlToText.fromString(dom.getElementsByTagName('body')[0].innerHTML, {
            wordwrap: 5000,
            preserveNewlines: true
        }).split("\n")[0]);
      let title = undefined;
      if (meta['og:title'] !== null && meta['og:title'] !== undefined) {
        title = meta['og:title'];
      } else if (res.data.match(regTitle) !== null && res.data.match(regTitle) !== undefined) {
        title = res.data.match(regTitle)[0].split(">")[1].split("<")[0];
      }
      if (title !== undefined && description !== undefined) {
        await writeEntry(url, title, description);
      } else if (title !== undefined && description === undefined) {
        await writeInvaildEntry(url, title);
      }
    }
  }
}


module.exports = findRecords
