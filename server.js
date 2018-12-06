var _ = require('lodash');
var fs = require('fs');
var promise = require('bluebird');
const http = require('http');
const https = require('https');
var express = require('express');
var app = express();
var cf_app = require('./app/vcap_application');
var cf_svc = require('./app/vcap_services');
var pg = require('pg');
var redis = require("redis");

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.static(__dirname + '/public'));

function testPostgres(info) {
    return new promise((resolve) => {
        var client = new pg.Client({
            user: info.credentials.username,
            host: info.credentials.hostname,
            database: info.credentials.dbname,
            password: info.credentials.password,
            port: info.credentials.port
        });
        client.connect((err) => {
            if (err) {
                resolve({
                    success: false,
                    message: `service ${info.name} connect error: ${err.stack}`
                });
            } else {
                client.query('SELECT $1::text as message', ['Database query successful!'], (err, results) => {
                    client.end();
                    if (err) {
                        resolve({
                            success: false,
                            message: `service ${info.name} query error: ${err.stack}`
                        });
                    } else {
                        resolve({
                            success: true,
                            message: `service ${info.name} query successful!`
                        });
                    }
                });
            }
        });
    });
}

function testRedis(info) {
    return new promise((resolve) => {
        var client = redis.createClient({
            host: info.credentials.hostname,
            password: info.credentials.password,
            port: info.credentials.port
        });
        client.get('test', (err, reply) => {
            if (err) {
                resolve({
                    success: false,
                    message: `service ${info.name} query error: ${err.stack}`
                });
            } else {
                resolve({
                    success: true,
                    message: `service ${info.name} query successful!`
                });
            }
        });
    });
}

function db(cb) {

    var vcaps = JSON.parse(process.env.VCAP_SERVICES);
    var results = [];

    if (vcaps.postgresql) {

        promise.mapSeries(vcaps.postgresql, (info) => {
            return testPostgres(info).then((result) => {
                results.push(result);
            });
        }).then(() => {
            cb(null, results);
        });
    } else if (vcaps.redis) {

        promise.mapSeries(vcaps.redis, (info) => {
            return testRedis(info).then((result) => {
                results.push(result);
            });
        }).then(() => {
            cb(null, results);
        });
    } else {
        cb(null, 'no services bound to this application.');
    }
}

app.get('/', function(req, res) {
    db((err, results) => {
        var dbresult = '';
        _.filter(results, (result) => {
            dbresult += result.message;
        });
        res.render('pages/index', {
            app_environment: app.settings.env,
            application_name: cf_app.get_app_name(),
            app_uris: cf_app.get_app_uris(),
            app_space_name: cf_app.get_app_space(),
            app_index: cf_app.get_app_index(),
            app_mem_limits: cf_app.get_app_mem_limits(),
            app_disk_limits: cf_app.get_app_disk_limits(),
            service_label: cf_svc.get_service_label(),
            service_name: cf_svc.get_service_name(),
            service_plan: cf_svc.get_service_plan(),
            processUptime: process.uptime(),
            dbresult: dbresult
        });
    });

});

app.get('/health', function(req, res) {
    db((err, results) => {
        var failed = _.find(results, {
            success: false
        });
        var success = failed ? false : true;
        var statuscode = failed ? 500 : 200;
        res.status(statuscode).json({
            success,
            results
        });
    });
});

app.get('/db', function(req, res) {


});

app.get('/env', function(req, res) {

    res.send(process.env);
});

app.get('/vcaps', function(req, res) {

    res.send(process.env.VCAP_SERVICES);
});


// Starting both http & https servers
const httpServer = http.createServer(app);
httpServer.listen(process.env.PORT, () => {
	console.log('HTTP Server running on port ' + process.env.PORT);
});

// const privateKey = fs.readFileSync(__dirname + '/privkey.pem', 'utf8');
// const certificate = fs.readFileSync(__dirname + '/cert.pem', 'utf8');
// const ca = fs.readFileSync(__dirname + '/chain.pem', 'utf8');
// const credentials = {
// 	key: privateKey,
// 	cert: certificate,
// 	ca: ca
// };
// const httpsServer = https.createServer(credentials, app);
// httpsServer.listen(process.env.PORT, () => {
// 	console.log('HTTPS Server running on port ' + process.env.PORT);
// });

