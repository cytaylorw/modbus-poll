const EventEmitter = require('events');
const ModbusRTU = require ("modbus-serial");
/* 
    RTU:            Connect to a communication port, using SerialPort.
    RTUBuffered:    Connect to a communication port, using Bufferd Serial port.
    AsciiSerial:    Connect to a communication port, using ASCII Serial port.
    TCP:            Connect to a communication port, using TcpPort.
    TcpRTUBuffered: Connect to a communication port, using TcpRTUBufferedPort.
    Telnet:         Connect to a communication port, using TelnetPort.
    UDP:            Connect to a communication port, using modbus-udp.
    C701:           Connect to a communication port, using C701 UDP-to-Serial bridge.
*/
const connectionTypes = {
    rtu: 'RTU',
    rtubuffered: 'RTUBuffered',
    asciiserial: 'AsciiSerial',
    tcp: 'TCP', 
    tcprtubuffered: 'TcpRTUBuffered', 
    telnet: 'Telnet', 
    udp: 'UDP', 
    c701: 'C701'};
/* 
    FC1:    Writes "Read coil status" (FC=01) request to serial port.
    FC2:    Writes "Read input status" (FC=02) request to serial port.
    FC3:    Writes "Read Holding Registers" (FC=03) request to serial port.
    FC4:    Writes "Read Input Registers" (FC=04) request to serial port.
    FC5:    Writes "Force Single Coil" (FC=05) request to serial port.
    FC6:    Writes "Preset Single Register" (FC=6) request to serial port.
    FC15:   Writes "Force Multiple Coils" (FC=15) request to serial port.
    FC16:   Writes "Preset Multiple Registers" (FC=16) request to serial port.
    FC43:   Write a Modbus "Read Device Identification" (FC=43) to serial port.
*/
const functionCodes = [ 'FC1','FC2','FC3','FC4','FC5','FC6','FC15','FC16','FC43'];
// const fcRegex = /FC\d{0,1}(\d)$/gi;

// Modbus 'state' constants
const MBS_STATE = {
    INIT          : "State init",
    IDLE          : "State idle/wait",
    NEXT          : "State next",
    GOOD_READ     : "State good (read)",
    FAIL_READ     : "State fail (read)",
    GOOD_WRITE_FC : "State good (write FC)",
    FAIL_WRITE_FC : "State fail (write FC)",
    GOOD_CONNECT  : "State good (port)",
    FAIL_CONNECT  : "State fail (port)",
    FAIL_STOP     : "State fail (cannot resovle)",
    DONE          : "State done",
    CLOSE         : "State close",
}

const defaultValue = {
    id: 1,
    timeout: 1500
}


class ModbusClient extends EventEmitter{
    constructor(){
        super();
        this.connection = new ModbusRTU();
        this.id = defaultValue.id;
        this.timeout = defaultValue.timeout;
        this.pollingList = { pointer:0 };
    }

    get id(){
        return this.connection.getID();
    }

    set id(id){
        this.connection.setID(id);
    }

    get timeout(){
        return this.connection.getTimeout();
    }

    set timeout(duration){
        this.connection.setTimeout(duration);
    }

    get isOpen(){
        return this.connection.isOpen;
    }
     
    get isPollingFinished(){
        return Boolean(this.pollingList.pointer+1 >= this.pollingList.pool.length);
    }

    get mbsState(){
        return this._mbsState;
    }

    set mbsState(value){
        this._mbsState = value;
        this.emit('stateChange',value,MBS_STATE[value]);
    }

    // Functions for wrapping basic modbus serial functions
    init(config){
        this.config = config;
    }
    
    connect(config){
        return new Promise((resolve, reject) => {
            config = typeof config === 'undefined' ? this.config : config;
            let connectionType = config.connection.toLowerCase();
            let connectMethod = 'connect';
            if(connectionTypes[connectionType]){
                connectMethod+=connectionTypes[connectionType];
            }else{
                this.mbsState = 'FAIL_STOP';
                    error = {message: `Connection type ${connectionType} not supported`};
                    this.emitError(error);
                    reject(error);
                    return;
            }

            // console.log(config.options)
            this.connection[connectMethod](config.host,config.options)
                .then(() =>
                {
                    this.mbsState = 'GOOD_CONNECT';
                    config.method=connectMethod;
                    this.emit('connect',config);
                    resolve();
                })
                .catch((e) =>
                {
                    this.mbsState = 'FAIL_CONNECT';
                    // console.log(e);
                    this.emitError(e);
                    reject(e);
                });
        })
        .catch(error => {})
    }

    close(){
        return new Promise((resolve, reject) => {
            this.connection.close(() => {
                this.mbsState = 'CLOSE';
                this.emit('close');
                resolve();
            });
        })
    }

    writeFC(options){
        return new Promise((resolve, reject) => {
            if(typeof options.fc === 'undefined'){
                this.mbsState = 'FAIL_WRITE_FC';
                let error = {message: `Function code is not defined`};
                this.emitError(error);
                reject(error);
                return;
            }
            let writeMethod = 'write';
            options.fc = options.fc.toString().toUpperCase();
            if(functionCodes.includes(options.fc)){
                writeMethod += options.fc;
            }else{
                this.mbsState = 'FAIL_WRITE_FC';
                let error = {message: `Unknown FC ${functionCode}`};
                this.emitError(error);
                reject(error);
                return;
            }

            options.id = options.id ? options.id : this.id;

            let thisData = false;
            this.connection[writeMethod](options.id, options.address, options.value, (error, data)=>{
                if(error){
                    this.emitError(error);
                    // console.log(error);
                    // Do not set fail state for error generated after data already received
                    if(thisData) return;

                    this.mbsState = 'FAIL_WRITE_FC';
                    reject(error);
                }else{
                    // Do not send data if already set
                    if(thisData) return;
                    
                    this.mbsState = 'GOOD_WRITE_FC';
                    data.createdAt = new Date();
                    data.options = options;
                    // console.log(data);
                    thisData = data;
                    this.emit('data',data);
                    resolve(data);
                }
            })
        })
    }

    read(options){
        // console.log(options);
        return new Promise( (resolve, reject) => {
            if(typeof options.fc === 'number'){
                options.fc = `FC${options.fc}`;
            }
            if(!ModbusClient.isReadFC(options.fc)){
                this.mbsState = 'FAIL_READ';
                let error = {message: `${options.fc} is not a read FC`};
                this.emitError(error);
                reject(error);
                return;
            }


            if(typeof options.value === 'undefined' && typeof options.length !== 'undefined'){
                options.value = options.length;
            }

            this.writeFC(options)
                .then(data => {
                    this.mbsState = 'GOOD_READ';
                    resolve(data);
                })
                .catch(error => {
                    this.mbsState = 'FAIL_READ';
                    // this.emitError(error);
                    reject(error);
                })
        })
    }

    // Functions for polling a list of function for a single time
    setPollingList(list){
        if(Array.isArray(list)){
            this.pollingList.pool = list;
        }else{
            this.pollingList.pool = [list];
        }        
    }

    getPollingItem(increment = false){
        if(increment){
            this.pollingList.pointer++;      
            if(this.pollingList.pointer >= this.pollingList.pool.length)
                this.pollingList.pointer = 0;
        }
        return this.pollingList.pool[this.pollingList.pointer];
    }

    startPolling(){
        this.pollingList.pointer = 0;
        this.retries = 0;
        this.mbsState = this.isOpen ? 'NEXT' : 'INIT';
        this.emit('polling-start');
        this.polling();
    }
    
    polling(){
        let nextAction;
        let nextPoll = false;
        // console.log(this.mbsState)
        switch (this.mbsState)
        {
            case 'INIT':
            case 'CLOSE':
                nextAction = this.connect.bind(this);
                break;

            case 'GOOD_READ':
            case 'GOOD_WRITE_FC':
                if(this.isPollingFinished) {
                    this.mbsState = 'DONE';
                    break;
                }
                nextPoll = true;
            case 'GOOD_CONNECT':
                this.retries = 0;
            case 'NEXT':
                nextAction = this.read.bind(this);
                break;
            case 'FAIL_CONNECT':
            case 'FAIL_READ':
            case 'FAIL_WRITE_FC':
                this.retries++;
                // console.log(`Reties #${this.retries}`)
                if(this.retries > 2)  { this.mbsState = 'FAIL_STOP';  }
                else if (this.isOpen)  { this.mbsState = 'NEXT';  }
                else                { nextAction = this.connect.bind(this); }
                break;

            case 'FAIL_STOP':
                // nextAction = this.close.bind(this);
                break;

            default:
                // nothing to do, keep scanning until actionable case
        }

        // console.log();
        // console.log(nextAction);

        // execute "next action" function if defined
        if (nextAction !== undefined)
        {
            this.mbsState = 'IDLE';
            let name = nextAction.name.split(' ');
            if(name[name.length-1] === 'read'){
                nextAction(this.getPollingItem(nextPoll))
                    .catch(error => {/* catch polling error with event */});
            }else{
                nextAction(this.config);
            }
        }

        // set for next run
        if(this.mbsState == 'DONE' || this.mbsState == 'FAIL_STOP') {
            delete this.pollingTimer;
            this.emit('polling-stop');
        }else{
            this.pollingTimer = setTimeout (this.polling.bind(this), this.config.writeInterval);
        }
    };

    stopPolling(){
        clearTimeout(this.pollingTimer);
        this.emit('polling-stop');
    }

    startMonitor(){
        let i = 1;
        this.emit('monitor-start');
        this.monitorTimer = setInterval(() => {
            if(!this.pollingTimer){
                // console.log(`Start #${i++}`);
                this.startPolling();
            }else{
                this.emitError({message: 'Monitor intervals overlapse'})
            }
        }, this.config.monitorInterval)
    }

    stopMonitor(){
        clearInterval(this.monitorTimer);
        this.stopPolling();
        this.emit('monitor-stop');
    }

    // Error emitter
    emitError(error){
        if (this.listeners('error').length > 0) this.emit('error',error);
    }

    // Static functions
    static isReadFC(stringFC){
        let fcRegex = /FC\d{0,1}(\d)$/gi;
        let matches =  fcRegex.exec(stringFC);
        return Boolean(matches && matches[1] && matches[1] > 0 && matches[1] < 5);
    }

    static isWriteFC(stringFC){
        let fcRegex = /FC\d{0,1}(\d)$/gi;
        let matches =  fcRegex.exec(stringFC);
        return Boolean(matches && matches[1] && matches[1] > 4 && matches[1] < 7);
    }

    static getConnectionTypes(){
        return connectionTypes;
    }

    static getFunctionCodes(){
        return functionCodes;
    }

    static getStates(){
        return MBS_STATE;
    }
}
module.exports = ModbusClient;