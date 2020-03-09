const router = require('express').Router();
const search = require('./search.js');

router.get('/', (req, res) => {
  res.sendFile(__dirname + "/client/home.html");
});

router.get('/js', (req, res) => {
  res.sendFile(__dirname + "/client/home.js");
});

router.get('/button', (req, res) => {
  res.sendFile(__dirname + "/client/go_button.png");
});

router.get('/search', (req, res) => {
  if (req.query.q == null || req.query.q == undefined || req.query.q == '') {
    res.redirect('/');
  } else {
    res.sendFile(__dirname + "/client/search.html");
  }
});

router.get('/results', (req, res) => {
  if (req.query.q != null && req.query.q != undefined && req.query.q != '') {
    search(req.query.q).then(function(data) {
      res.json(data);
    });
  } else {
    res.json();
  }
});

router.put('/result/increment', (req, res) => {
  console.log(req.body);
  res.sendStatus(200);
});

router.get('/search/js', (req, res) => {
  res.sendFile(__dirname + "/client/search.js");
});

router.get('*', (req, res) => {
  res.status(404).redirect('/');
});

module.exports = router;