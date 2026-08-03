const models = require('./MongoModels.js');
const options = [{
  $project: {
    "_id": 1, // keep the _id field where it is anyway
    "doc": "$$ROOT" // store the entire document in the "doc" field
  }
}, {
  $project: {
    "doc._id": 0 // remove the _id from the stored document because we do not want to compare it
  }
}, {
  $group: {
    "_id": "$doc", // group by the entire document's contents as in "compare the whole document"
    "ids": {
      $push: "$_id"
    }, // create an array of all IDs that form this group
    "count": {
      $sum: 1
    } // count the number of documents in this group
  }
}, {
  $match: {
    "count": {
      $gt: 1
    } // only show what's duplicated
  }
}];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
//Requires a pre-exsisting connection to MongoDB
function deleteDups() {
  sleep(1000).then(function() {
    models.Url.aggregate(options).exec().then(function(arr) {
      if (arr.length !== 0) {
        let dups = 0;
        for (let i = 0; i < arr.length; i++) {
          for (let j = 0; j < arr[i].ids.length - 1; j++) {
            models.Url.deleteMany({
              _id: arr[i].ids[j]
            }, async function(err) {
              if (err) {
                throw (err);
              } else {
                await sleep(500);
              }
            });
          }
        }
        return;
      }
    });
  });

  sleep(1000).then(function() {
    models.Entry.aggregate(options).exec().then(function(arr) {
      if (arr.length !== 0) {
        let dups = 0;
        for (let i = 0; i < arr.length; i++) {
          for (let j = 0; j < arr[i].ids.length - 1; j++) {
            models.Entry.deleteOne({
              _id: arr[i].ids[j]
            }, async function(err) {
              if (err) {
                throw (err);
              } else {
                await sleep(500);
              }
            });
          }
        }
        return;
      }
    });
  });
}

module.exports = deleteDups;
