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
var redis = require('redis');
var rp = require('request-promise');
var cfenv = require('cfenv');

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

function getAuth(){

    const uaa_service = cfenv.getAppEnv().getService('gxsuaa');
    const dest_service = cfenv.getAppEnv().getService('gdest');
    const sUaaCredentials = dest_service.credentials.clientid + ':' + dest_service.credentials.clientsecret;

    if(!uaa_service) {
        return promise.reject(new Error('No xsuaa service found.'));
    }

    if(!dest_service) {
        return promise.reject(new Error('No destination service found.'));
    }

    var isgood = false;
    if(global.auth){
        if(global.auth_time){
            var now = new Date().getTime();
            var diff = now - global.auth_time;
            var expires_in = (global.auth.expires_in - 60) * 1000;
            if(diff <= expires_in){
                isgood = true;
            }
        }
    }

    if(isgood){
        return;
    } else {
        return rp({
            method: 'POST',
            uri: uaa_service.credentials.url + '/oauth/token',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(sUaaCredentials).toString('base64')
            },
            form: {
                'client_id': dest_service.credentials.clientid,
                'grant_type': 'client_credentials'
            },
            json: true
        }).then((data) => {
            global.auth = data;
            global.auth_time = new Date().getTime();
        });
    }
}

app.get('/destinations/auth', (req, res, next) => {

    getAuth().then(() => {
        res.json(global.auth);
    }).catch((err) => {
        next(err);
    });
});

app.get('/destinations/setup', (req, res, next) => {

    const dest_service = cfenv.getAppEnv().getService('gdest');
    return rp({
        method: 'GET',
        uri: dest_service.credentials.uri + '/destination-configuration/v1/instanceDestinations/',
        headers: {
            'Authorization': 'Bearer ' + global.auth.access_token
        },
        json: true
    }).then((data) => {
        var testdestination = _.find(data, {
            Name: 'test'
        });
        var method = testdestination ? 'PUT': 'POST';
        return rp({
            method: method,
            uri: dest_service.credentials.uri + '/destination-configuration/v1/instanceDestinations/',
            headers: {
                'Authorization': 'Bearer ' + global.auth.access_token
            },
            body: {
                Name: 'test',
                Type: 'HTTP',
                URL: 'http://ghost:12345',
                ProxyType: 'OnPremise',
                LocationID: 'gcloudconnector',
                Authentication: 'NoAuthentication'
            },
            json: true
        }).then((data) => {
            res.json(data);
        });
    }).catch((err) => {
        next(err);
    });
});

app.get('/destinations/get', (req, res, next) => {

    const dest_service = cfenv.getAppEnv().getService('gdest');
    return rp({
        method: 'GET',
        uri: dest_service.credentials.uri + '/destination-configuration/v1/destinations/test',
        headers: {
            'Authorization': 'Bearer ' + global.auth.access_token
        },
        json: true
    }).then((data) => {
        res.json(data);
    }).catch((err) => {
        next(err);
    });
});

app.get('/destinations/test', (req, res, next) => {

    const conn_service = cfenv.getAppEnv().getService('gconn');
    const uaa_service = cfenv.getAppEnv().getService('gxsuaa');
    const sUaaCredentials = conn_service.credentials.clientid + ':' + conn_service.credentials.clientsecret;

    rp({
        method: 'POST',
        uri: uaa_service.credentials.url + '/oauth/token',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(sUaaCredentials).toString('base64')
        },
        form: {
            'client_id': conn_service.credentials.clientid,
            'grant_type': 'client_credentials'
        },
        json: true
    }).then((auth) => {
        // res.json(conn_service);
        //proxy: `http://${conn_service.credentials.clientid}:${conn_service.credentials.clientsecret}@${conn_service.credentials.onpremise_proxy_host}:${conn_service.credentials.onpremise_proxy_port}`,
        return rp({
            method: 'GET',
            uri: 'http://ghost:12345/',
            proxy: `http://${conn_service.credentials.onpremise_proxy_host}:${conn_service.credentials.onpremise_proxy_port}`,
            headers: {
                'Proxy-Authorization': 'Bearer ' + auth.access_token,
                'SAP-Connectivity-SCC-Location_ID': 'gcloudconnector'
            },
            json: true
        }).then((data) => {
            res.json(data);
        });
    }).catch((err) => {
        next(err);
    });
});

// Starting http server
const httpServer = http.createServer(app);
httpServer.listen(process.env.PORT, () => {
	console.log('HTTP Server running on port ' + process.env.PORT);
});

