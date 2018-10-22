var express = require('express');
var app = express();
var cf_app = require('./app/vcap_application');
var cf_svc = require('./app/vcap_services');

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.static(__dirname + '/public'));

function db(cb) {
    const {
        Client
    } = require('pg');
    var vcaps = JSON.parse(process.env.VCAP_SERVICES);
    const client = new Client({
        user: vcaps.postgresql[0].credentials.username,
        host: vcaps.postgresql[0].credentials.hostname,
        database: vcaps.postgresql[0].credentials.dbname,
        password: vcaps.postgresql[0].credentials.password,
        port: vcaps.postgresql[0].credentials.port
    });
    client.connect((err) => {
        if (err) {
            cb(err.stack);
        } else {
            client.query('SELECT $1::text as message', ['Database query successful!'], (err, results) => {
                if (err) {
                    cb(err.stack);
                } else {
                    cb(null, results.rows[0].message);
                }
                client.end();
            });
        }
    });
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