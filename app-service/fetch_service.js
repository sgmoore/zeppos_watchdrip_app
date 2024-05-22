import {log} from "@zos/utils";
import * as appServiceMgr from "@zos/app-service";
import {Time} from "@zos/sensor";
import {Commands, FETCH_SERVICE_ACTION, FETCH_STALE, SERVER_INFO_URL, SERVER_URL} from "../utils/config/constants";

import {connectStatus} from '@zos/ble'
import * as alarmMgr from '@zos/alarm'
import {
    ALARM_SERVICE_NAME,
    FETCH_SERVICE_NAME,
    GRAPH_FETCH_PARAM,
    WATCHDRIP_INFO_DEFAULTS,
    WATCHDRIP_SETTINGS_DEFAULTS,
    WF_CONFIG_FILE,
    WF_INFO_FILE,
    WF_STATUS_FILE
} from "../utils/config/global-constants";
import {Path} from "../utils/path";
import {zeroPad} from "../shared/date";
import {getTimestamp, isTimeout, objToString} from "../utils/helper";
import {BasePage} from "@zeppos/zml/base-page";
import {InfoStorage} from "../utils/watchdrip/infoStorage";


const logger = log.getLogger("fetch-service");

/*
typeof WatchdripService
*/
let service = null;


let timeSensor = new Time();


class WatchdripService {


    /*
    *  @param {BasePage} base
    */
    constructor(base) {
        this.base = base;
        this.infoFile = new Path("full", WF_INFO_FILE);
        this.updatingData = false;

        this.configStorage = new InfoStorage(
            new Path("full", WF_CONFIG_FILE),
            WATCHDRIP_SETTINGS_DEFAULTS
        );

        this.statusStorage = new InfoStorage(
            new Path("full", WF_STATUS_FILE),
            WATCHDRIP_INFO_DEFAULTS
        );
    }


    updateError() {
        if (this.statusStorage.data.lastUpdSuccess) {
            this.resetError();
        } else {
            this.setError('status_start_watchdrip');
        }
    }

    //**workaround** add timeout to properly save storage data
    delayExit(timeout = 100) {
        setTimeout(() => {
            appServiceMgr.exit();
        }, timeout);
    }



    init(data) {
        logger.log(`init ${data.action}`);
        switch (data.action) {
            case FETCH_SERVICE_ACTION.START:
                this.prepareFetchInfo();
                break;
            case FETCH_SERVICE_ACTION.UPDATE:
                this.prepareFetchInfo();
                break;
            case FETCH_SERVICE_ACTION.STOP:
                this.stopService();
                break;
        }
    }



    getAlarmId() {
        let alarms = alarmMgr.getAllAlarms();
        if (alarms.length) {
            return alarms[0];
        }
        return 0;
    }

    setNextFetchAlarm(delay) {
        logger.log(`setNextFetchAlarm`);
        let param = JSON.stringify({
            action: FETCH_SERVICE_ACTION.UPDATE
        });
        const option = {
            url: FETCH_SERVICE_NAME,
            param: param,
            delay: delay
        }
        let newAlarmId = alarmMgr.set(option);
        if (newAlarmId) {
            logger.log(`Next runAlarm id ${newAlarmId}`);
        } else {
            logger.log('!!!cannot create  Next ALARM');
        }
        this.updatingData = false;
    }

    prepareFetchInfo() {
        logger.log("prepareFetchInfo");
        if (this.updatingData) {
            if (isTimeout(this.statusStorage.data.lastUpdAttempt, FETCH_STALE)) {
                this.setNextFetchAlarm(60);
                logger.log("restart fetch, return");
                return;
            }


            logger.log("updatingData, return");
            return;
        }


            this.fetchInfo();

    }

    fetchInfo() {
        logger.log("fetchInfo");

        this.resetLastUpdate();
        this.save();

        if (!connectStatus()) {
            logger.log("No BT Connection");
            this.setError('status_no_bt');
            this.save();
            return;
        }
        this.updatingData = true;
        let params = '';
        this.configStorage.read();
        if (this.configStorage.data.s_graphInfo) {
            params = GRAPH_FETCH_PARAM;
        }
        logger.log("request");

        let url = SERVER_URL;

        this.base.httpRequest({
            method: 'GET',
            url:  url + SERVER_INFO_URL + "?" + params,
        })
            .then(
            (response) => {
                if (!response.body){
                    logger.log("No Data");
                    return;
                }
                let {body: info = {}} = response;
                logger.log(objToString(info));
                try {
                    this.saveInfo(info);
                } catch (e) {
                    logger.log("error:" + e);
                }
            })
            .catch((error) => {
                logger.log("fetch error:" + error);
            })
            .finally(() => {
                this.updateError();
                this.save();
                this.setNextFetchAlarm(60);

                if (!this.statusStorage.data.lastUpdSuccess) {
                    logger.log(`FAIL UPDATE`);
                }
            });
    }

    setError(error) {
        this.statusStorage.data.lastError = error;
        //this.save();
    }

    resetError() {
        if (this.statusStorage.data.lastError) {
            this.setError('');
        }
    }

    resetLastUpdate() {
        //logger.log("resetLastUpdate");
        this.statusStorage.data.lastUpdAttempt = getTimestamp();
        this.statusStorage.data.lastUpdSuccess = false;
    }

    saveInfo(data) {
        logger.log("saveInfo");
        //logger.log(data);
        this.infoFile.overrideWithText(data);
        this.statusStorage.data.lastUpd = getTimestamp();
        this.statusStorage.data.lastUpdSuccess = true;
        //this.save();
    }

    stopService() {
        logger.log(`stopService`);
        let alarmId = this.getAlarmId();
        if (alarmId) {
            logger.log(`remove alarm id ${alarmId})`);
            alarmMgr.cancel(alarmId);
        }
        appServiceMgr.exit();
    }

    destroy() {
    }

    save() {
        this.statusStorage.save();
    }
}

function getTime() {
    return (
        zeroPad(timeSensor.getHours()) +
        ":" +
        zeroPad(timeSensor.getMinutes()) +
        ":" +
        zeroPad(timeSensor.getSeconds()) +
        "." +
        zeroPad(timeSensor.getTime() % 1000, 4)
    );
}

function handle(p,base) {
    try {
        logger.log(`handle`);
        let data = {action: FETCH_SERVICE_ACTION.UNKNOWN};
        try {
            if (!(!p || p === 'undefined')) {
                data = JSON.parse(p);
            }
        } catch (e) {
            data = {action: p}
        }
        if (service == null) {
            service = new WatchdripService(base)
        }
        service.init(data);
    } catch (e) {
        logger.log('LifeCycle Error ' + e)
        e && e.stack && e.stack.split(/\n/).forEach((i) => logger.log('error stack:' + i))
    }
}

AppService(BasePage(
    {
        onEvent(p) {
            logger.log(`service onEvent(${p})`);
            handle(p, this);
        },
        onInit(p) {
            logger.log(`service onInit(${p}) ${getTime()}`);
            handle(p,this);
        },
        onDestroy() {
            logger.log(`service on destroy invoke ${getTime()}`);
            if (service) {
                service.destroy();
                //service = null;
            }
        }
    })
);