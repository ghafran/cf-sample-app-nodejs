var promise = require('bluebird');
var express = require('express');
var app = express();
var cf_app = require('./app/vcap_application');
var cf_svc = require('./app/vcap_services');
var pg = require('pg');
var redis = require("redis");

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.static(__dirname + '/public'));

function testPostgres(info){
    return new promise((resolve)=>{
        var client = new pg.Client({
            user: info.credentials.username,
            host: info.credentials.hostname,
            database: info.credentials.dbname,
            password: info.credentials.password,
            port: info.credentials.port
        });
        client.connect((err) => {
            if (err) {
                resolve(`service ${info.name} connect error: ${err.stack}`);
            } else {
                client.query('SELECT $1::text as message', ['Database query successful!'], (err, results) => {
                    client.end();
                    if (err) {
                        resolve(`service ${info.name} query error: ${err.stack}`);
                    } else {
                        resolve(`service ${info.name} query successful!`);
                    }
                });
            }
        });
    });
}

function testRedis(info){
    return new promise((resolve)=>{
        var client = redis.createClient({
            host: info.credentials.hostname,
            password: info.credentials.password,
            port: info.credentials.port
        });
        client.get('test', (err, reply) => {
            if(err){
                resolve(`service ${info.name} query error: ${err.stack}`);
            } else {
                resolve(`service ${info.name} query successful!`);
            }
        });
    });
}

function db(cb) {

    var vcaps = JSON.parse(process.env.VCAP_SERVICES);
    var results = '';

    if(vcaps.postgresql){
        
        promise.mapSeries(vcaps.postgresql, (info)=>{
            return testPostgres(info).then((result)=>{
                results += result;
            });
        }).then(()=>{
            cb(null, results);
        });
    } else if(vcaps.redis){
        
        promise.mapSeries(vcaps.redis, (info)=>{
            return testRedis(info).then((result)=>{
                results += result;
            });
        }).then(()=>{
            cb(null, results);
        });
    } else {
        cb(null, 'no services bound to this application.');
    }
}

app.get('/', function(req, res) {
    db((err, result) => {
        var dbresult;
        if (err) {
            dbresult = err;
        } else {
            dbresult = result;
        }
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

app.get('/db', function(req, res) {


});

app.get('/env', function(req, res) {

    res.send(process.env);
});

app.get('/vcaps', function(req, res) {

    res.send(process.env.VCAP_SERVICES);
});

app.listen(process.env.PORT || 4000);