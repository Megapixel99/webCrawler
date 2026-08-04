require('dotenv').config();
const mongoose = require('mongoose');

const mongoConnectString = process.env.MONGO_URI;
if (!mongoConnectString) {
    console.error('Missing MONGO_URI environment variable. Set it in a .env file (see .env.example).');
    console.error('Process exited with code: 1');
    process.exit(1);
}

function connect() {
    mongoose.connect(mongoConnectString, {
      useNewUrlParser: true,
      useFindAndModify: false,
      useCreateIndex: true,
      useUnifiedTopology: true
    });
    const mongoDB = mongoose.connection;

    mongoDB.on('error', (err) => {
        console.error('MongoDB error: \n' + err);
        throw err;
    });
    if (mongoDB.readyState === 2) {
        mongoDB.once('connected', () => {
            console.log('Connected to MongoDB!');
            return true;
        });
    } else {
        throw (new Error('Not connected to MongoDB'));
    }
}

async function closeConnection() {
    const mongoDB = mongoose.connection;
    if (mongoDB.readyState === 1) {
        mongoDB.close();

        mongoDB.on('error', (err) => {
            console.error('MongoDB error: ' + err);
            throw err;
        });
    }
    return mongoDB.once('disconnected', () => {
        console.log('Disconnected from MongoDB!');
    });
}

function getConnectionStatus() {
    return mongoose.connection.readyState;
}

module.exports = {
    connect,
    closeConnection,
    connectionStatus: getConnectionStatus,
};
