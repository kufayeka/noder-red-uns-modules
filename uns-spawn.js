module.exports = function(RED) {
    function UnsSpawnNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const redisCfg = RED.nodes.getNode(config.redisConfig);
        if (!redisCfg) {
            node.error("Missing Redis config");
            node.status({ fill: 'red', shape: 'ring', text: 'No Redis config' });
            return;
        }

        const client = redisCfg.getClient();

        const keyJson = `unified/${config.uns}`;
        const keyHistory = `history/${config.uns}`;

        // --- create timeseries if historian enabled ---
        (async () => {
            if (config.enableHistorian) {
                try {
                    await client.call('TS.CREATE', keyHistory, 'RETENTION', config.ttl > 0 ? config.ttl * 1000 : 0);
                } catch (e) {
                    if (!e.message.includes('ERR TSDB: key already exists')) {
                        node.error(`Error creating TS: ${e.message}`);
                    }
                }
            }
        })();

        node.on("input", async (msg, send, done) => {
            try {
                if (!config.enableStatus) {
                    node.status({ fill: "grey", shape: "ring", text: "disabled" });
                    return;
                }

                const value = RED.util.evaluateNodeProperty(config.valueSource, config.valueSourceType, node, msg);
                let timestamp = Date.now();
                if (config.timestampSource) {
                    timestamp = RED.util.evaluateNodeProperty(config.timestampSource, config.timestampSourceType, node, msg);
                }

                // --- store JSON ---
                const data = {
                    uns: config.uns,
                    value,
                    unit: config.unit,
                    description: config.description,
                    ts: timestamp
                };
                await client.call('JSON.SET', keyJson, '$', JSON.stringify(data));
                if (config.ttl > 0) {
                    await client.expire(keyJson, config.ttl);
                }

                // --- store historian ---
                if (config.enableHistorian) {
                    await client.call('TS.ADD', keyHistory, isoToEpochManual(timestamp), value, 'ON_DUPLICATE', 'LAST');
                }

                msg.payload = data;
                send(msg);
                node.status({ fill: "green", shape: "dot", text: `value: ${value} | uns: ${config.uns}` });
                done();
            } catch (err) {
                node.error(err.message, msg);
                node.status({ fill: "red", shape: "ring", text: err.message });
                done(err);
            }
        });

        node.on("close", async (removed, done) => {
            if (removed && config.enableHistorian) {
                try {
                    await client.del(keyHistory);
                } catch (err) {
                    node.warn(`Error deleting TS: ${err.message}`);
                }
            }
            done();
        });
    }

    RED.nodes.registerType("uns-spawn", UnsSpawnNode);
};

/** Convert ISO timestamp to exact epoch ms */
function isoToEpochManual(iso) {
    // iso: "2025-08-17T04:17:06.400Z"
    const parts = iso.match(/\d+/g).map(Number); // ["2025","08","17","04","17","06","400"]
    const [year, month, day, hour, min, sec, ms] = parts;
    return Date.UTC(year, month-1, day, hour, min, sec, ms);
}
