const ModbusClient = require('../')
const async = require('async')

const mbConfig = {
    connection: 'tcp',
    host: 'localhost',
    options: {
        port: 502
    },
    scanInterval: 1000,
    monitorInterval: 5000
}

const polllingList = [
    { id: 1, fc: 'FC1', address: 0, length: 1 },
    { id: 1, fc: 'FC1', address: 1, length: 1 },
    { id: 1, fc: 'FC1', address: 2, length: 1 },
    { id: 1, fc: 'FC1', address: 3, length: 1 },
    { id: 1, fc: 'FC1', address: 4, length: 1 },
    { id: 1, fc: 'FC1', address: 5, length: 1 },

]

const polllingList2 = [
    { id: 1, fc: 'FC3', address: 0, length: 1 },
    { id: 1, fc: 'FC3', address: 1, length: 1 },
    { id: 1, fc: 'FC3', address: 2, length: 1 },
    { id: 1, fc: 'FC3', address: 3, length: 1 },
    { id: 1, fc: 'FC3', address: 4, length: 1 },
    { id: 1, fc: 'FC3', address: 5, length: 1 },

]

let client = new ModbusClient();
async.waterfall([
    (cbAsync) => {
        client.connect(mbConfig)
        .then(() => {
            // client.id=2;
            client.on('data', data => {
                console.log(data)
            })
            client.on('connect', config => {
                console.log(config)
            })
            client.on('close', config => {
                console.log('Connection closed.')
            })
            client.on('error', error => {
                console.log(error)
            })
            return client.read({fc: 'fc3',address: 0, length: 10});
        })
        .then(() => {
            return client.writeFC({fc: 'fc3',id: 1, address: 0, value: 10});
        })
        .catch((e) => {
            // console.log(e);
        })
        .finally(async () => {
            await client.close();
            console.log('Connection closed.');
            cbAsync(null, client)
        });
    },
    (client, cbAsync) => {
        client.init(mbConfig);
        client.initPolling(polllingList2);
        // console.log(client.pollingList)
        client.on('polling-start',()=> {
            console.log('Polling start')
        })
        client.on('polling-stop',()=> {
            cbAsync(null, client);
            client.removeAllListeners('polling-stop')
            client.removeAllListeners('polling-start')
            console.log('Polling stop')
        })
        client.startPolling();
        // setTimeout(client.stopPolling,1000);

    },
    (client, cbAsync) => {
        client.init(mbConfig);
        client.initPolling(polllingList2);
        client.startMonitor();
        client.on('monitor-start',()=> {
            console.log('monitor start')
        })
        client.on('monitor-stop',()=> {
            client.removeAllListeners('monitor-stop')
            client.removeAllListeners('monitor-start')
            console.log('monitor stop')
        })
        setTimeout(() => {
            client.stopMonitor();
            cbAsync(null, client)
        },10000)
    },
    (client, cbAsync) => {
        client.stopPolling();
        client.close();
    }
],err => {console.log(err)})
