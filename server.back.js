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
