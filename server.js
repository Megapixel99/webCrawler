// written by Seth Wheeler
const express = require('express');
const bodyParser = require('body-parser');
const dcconn = require('./databaseConnect.js');

const app = express();

dcconn.connect();

app.set('json spaces', 2);
app.use(require('helmet')());

app.use(bodyParser.json());
app.use(require('./Router.js'));

app.listen(3000);
