class RedisTimeseries {
    constructor(client, node) {
        this.client = client;
        this.node = node;
    }

    async createTSIfNotExist(uns, retention = 86400000) {
        const tsKey = `hist:${uns}`;
        try {
            await this.client.call('TS.CREATE', tsKey,
                'RETENTION', retention,
                'LABELS', 'type', 'historian', 'uns', uns
            );
            this.node.warn(`TimeSeries created: ${tsKey}`);
        } catch (err) {
            if (err.message.includes('TSDB: key already exists')) {
                this.node.warn(`TimeSeries already exists: ${tsKey}`);
            } else {
                this.node.error(`TS create error: ${err.message}`);
            }
        }
        return tsKey;
    }

    /** Convert ISO timestamp to exact epoch ms */
    isoToEpochManual(iso) {
        // iso: "2025-08-17T04:17:06.400Z"
        const parts = iso.match(/\d+/g).map(Number); // ["2025","08","17","04","17","06","400"]
        const [year, month, day, hour, min, sec, ms] = parts;
        return Date.UTC(year, month-1, day, hour, min, sec, ms);
    }

    async addData(tsKey, timestamp, value) {
        // timestamp bisa ISO string atau epoch
        const tsEpoch = typeof timestamp === 'string' ? this.isoToEpochManual(timestamp) : timestamp;
        await this.client.call('TS.ADD', tsKey, tsEpoch, value, 'DUPLICATE_POLICY', 'LAST');
    }

    async deleteTS(tsKey) {
        try {
            await this.client.del(tsKey);
            this.node.warn(`TimeSeries deleted: ${tsKey}`);
        } catch (err) {
            this.node.error(`Error deleting TS: ${err.message}`);
        }
    }

    async existsTS(tsKey) {
        try {
            const res = await this.client.exists(tsKey);
            return res === 1;
        } catch (err) {
            this.node.error(`Error checking TS: ${err.message}`);
            return false;
        }
    }
}

module.exports = RedisTimeseries;
