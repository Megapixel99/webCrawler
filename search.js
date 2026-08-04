const models = require('./MongoModels.js');
const tokenizer = require('./tokenizer.js');

module.exports = async (str) => {
  const k1 = 1.2, b = 0.75;
  const queryTokens = [...new Set(tokenizer(str.split(' ')))];
  const n = await models.Entry.countDocuments();
  const agg = await models.Entry.aggregate([{ $group: { _id: null, a: { $avg: '$Length' } } }]);
  const avgdl = agg[0]?.a || 1;

  const score = {};
  for (const term of queryTokens) {
    const index = await models.IndexTerm.findOne({ term });
    if (!index) continue;
    const idf = Math.log((n - index.df + 0.5) / (index.df + 0.5) + 1);
    for (const p of index.postings) {
      score[p.docId] = (score[p.docId] || 0) +
        idf * (p.tf * (k1 + 1)) / (p.tf + k1 * (1 - b + b * p.len / avgdl));
    }
  }

  const ids = Object.keys(score);
  const docs = await models.Entry.find({ _id: { $in: ids } });
  return docs
    .map(d => ({ ...d.toObject(), score: score[d._id] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
};
