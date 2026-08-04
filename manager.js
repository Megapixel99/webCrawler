const cluster = require('cluster');
var os = require('os');
const search = require('./index.js');
const moment = require('moment');
const deleteDups = require('./deleteDups.js');
const models = require('./MongoModels.js');
let memUsed = 125000000;
// var max_processes = Math.floor(os.cpus().length * 3.25);
var max_processes = Math.floor(os.freemem()/memUsed);
// let max_processes = 1;
let current_processes = 0;
let urls = [];
let initURLs = ["https://moz.com/top500", "https://gist.github.com/demersdesigns/4442cd84c1cc6c5ccda9b19eac1ba52b", "https://ahrefs.com/blog/most-visited-websites/", "https://fossbytes.com/most-useful-websites-internet/"];
require('console-stamp')(console, {
  metadata: function() {
    return ('[' + process.pid + ']');
  },
  colors: {
    stamp: 'yellow',
    label: 'white',
    metadata: 'green'
  }
});

function newProccess(url) {
  if (current_processes < max_processes) {
    cluster.fork({ URL: url });
    urls.shift();
    current_processes++;
  }
}

cluster.on('fork', function(worker) {
  console.log("Child process " + worker.process.pid + " created");
});
cluster.on('exit', async function(worker, code, signal) {
    console.log("Child process " + worker.process.pid + " exited");
    current_processes--;
    if (urls.length === 0 || urls[0] === undefined || urls[0] === null) {
      urls = (await models.Url.find().exec());
      let random = Math.floor(Math.random() * urls.length);
      urls = (await models.Url.find().skip(random).limit(20).exec());
      console.log("Retrieved " + urls.length + " URLs from the database");
    }
    if (urls.length === 0 || urls[0] === undefined || urls[0] === null) {
      for (let k = 0; k < initURLs.length; k++) {
        urls.push({ Url: initURLs[k]})
      }
    }
    newProccess(urls[0].Url);
});

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (cluster.isMaster) {
    masterProcess();
} else {
    childProcess();
}

async function masterProcess() {
  dbconn = require('./databaseConnect.js');
  console.log(`Manager is running`);

  setInterval(function() {
    // deleteDups();
  }, 2500);

  dbconn.connect();
  await sleep(500);

  urls = (await models.Url.find().exec());
  let random = Math.floor(Math.random() * urls.length);
  urls = (await models.Url.find().skip(random).limit(20).exec());
  console.log("Retrieved " + urls.length + " URLs from the database");
  if (urls.length <= 0) {
    for (let k = 0; k < initURLs.length; k++) {
      urls.push({ Url: initURLs[k]})
    }
  }
  for (let i = 0; i < max_processes; i++) {
    if (urls[0]) {
      newProccess(urls[0].Url);
      urls.shift();
    }
  }
}

async function childProcess() {
    require('./databaseConnect.js').connect();
    await search(process.env.URL, process.pid);
    process.exit(0);
}
