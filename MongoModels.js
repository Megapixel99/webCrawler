const mongoose = require('mongoose');

const validEntrySchema = mongoose.Schema({
  Url: String,
  Title: String,
  Description: String,
  Words: [String],
  Clicks: Number,
  FoundAt: Date,
  Length: Number,
});

const invalidEntrySchema = mongoose.Schema({
  Url: String,
  Title: String,
  Clicks: Number
});

const urlSchema = mongoose.Schema({
  Url: String,
  FoundAt: Date,
});

const indexSchema = mongoose.Schema({
  term: {
    type: String,
    index: true,
    unique: true
  },
  df: Number,
  postings: [{
    docId: mongoose.ObjectId,
    tf: Number
  }]
});

const hostSchema = mongoose.Schema({
  host: {
    type: String, 
    index: true,
    unique: true
  },
  robotsTxt: String,
  robotsCheckedAt: Date,
  crawlDelay: Number,
  fetchedAt: Date,
  nextAllowedAt: Date,
});

module.exports = {
  Entry: mongoose.model('entries', validEntrySchema),
  InvalidEntry: mongoose.model('invalidEntries', invalidEntrySchema),
  Url: mongoose.model('urls', urlSchema),
  IndexTerm: mongoose.model('index', indexSchema),
  Host: mongoose.model('hosts', hostSchema),
};
