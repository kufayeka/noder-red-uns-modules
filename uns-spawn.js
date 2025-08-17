module.exports = function(RED) {
    const RedisTimeseries = require('./redis/redis-timeseries');

    function UNS_SpawnNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const redisCfg = RED.nodes.getNode(config.redisConfig);
        if (!redisCfg) {
            node.error("Missing Redis config");
            node.status({ fill: 'red', shape: 'ring', text: 'Missing Redis config' });
            return;
        }
        const client = redisCfg.getClient();
        const tsHelper = new RedisTimeseries(client, node);

        let tsKey = null;
        const defaultThrottleInterval = parseInt(config.statusThrottleInterval) || 1000;
        let lastStatusUpdate = 0;

        // --- Setup TS saat startup / restart ---
        async function setupTSOnStartup(uns) {
            tsKey = `hist:${uns}`;

            if (config.enableHistorian) {
                const existsAfter = await tsHelper.existsTS(tsKey);
                if (!existsAfter) {
                    await tsHelper.createTSIfNotExist(tsKey, parseInt(config.historianRetention) || 86400000);
                }

                 if (config.alwaysClearHistorian) {
                    const exists = await tsHelper.existsTS(tsKey);
                    if (exists) {
                        await tsHelper.deleteTS(tsKey);
                    }
                }
            }


        }

        client.on('ready', async () => {
            node.status({ fill: 'green', shape: 'dot', text: 'Redis connected' });

            // Build UNS awal dari config
            const parts = [config.root, config.org, config.siteType, config.siteName];
            if (config.subsiteType && config.subsiteName) parts.push(config.subsiteType, config.subsiteName);
            if (config.deviceGroup) parts.push(config.deviceGroup);
            if (config.deviceName) parts.push(config.deviceName);
            parts.push(config.parameterName);
            const uns = parts.join('/');

            await setupTSOnStartup(uns);
        });

        // --- Input message handler ---
        node.on('input', async (msg, send, done) => {
            try {
                // Ambil data
                let data;
                switch (config.dataSourceType) {
                    case 'flow': data = node.context().flow.get(config.dataSource); break;
                    case 'global': data = node.context().global.get(config.dataSource); break;
                    default: data = RED.util.getMessageProperty(msg, config.dataSource);
                }

                // Build UNS dinamis per msg
                const parts = [msg.root || config.root, msg.org || config.org, msg.siteType || config.siteType, msg.siteName || config.siteName];
                if (msg.subsiteType && msg.subsiteName) parts.push(msg.subsiteType, msg.subsiteName);
                if (msg.deviceGroup) parts.push(msg.deviceGroup);
                if (msg.deviceName) parts.push(msg.deviceName);
                parts.push(msg.parameterName || config.parameterName);
                const uns = parts.join('/');
                msg.topic = uns;

                const store = {
                    metadata: { ...msg, uns, last_update: Date.now(), status: msg.status || 'up' },
                    value: data
                };
                msg.payload = store;
                msg.metadata = store;
                msg.value = data;

                const ttl = parseInt(msg.ttl) || parseInt(config.ttl) || 0;
                if (ttl > 0) await client.set(uns, JSON.stringify(store), 'EX', ttl);
                else await client.set(uns, JSON.stringify(store));

                // --- Historian ADD DATA ---
                let timestampSource;
                switch (config.historianTimestampType) {
                    case 'flow': timestampSource = node.context().flow.get(config.historianTimestamp); break;
                    case 'global': timestampSource = node.context().global.get(config.historianTimestamp); break;
                    default: timestampSource = RED.util.getMessageProperty(msg, config.historianTimestamp);
                }

                if (config.enableHistorian && tsKey) {
                    const tsHist = timestampSource || Date.now();
                    await tsHelper.addData(tsKey, tsHist, data);
                }

                const now = Date.now();
                if (now - lastStatusUpdate >= defaultThrottleInterval) {
                    node.status({ fill: 'green', shape: 'dot', text: `value: ${data} | uns: ${uns}` });
                    lastStatusUpdate = now;
                }

                send(msg);
                done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: `Error: ${err.message}` });
                node.error(err.message, msg);
                done(err);
            }
        });

        node.on('close', async (removed, done) => {
            try {
                if (removed && tsKey) { 
                    // Node dihapus permanen → delete TS
                    await tsHelper.deleteTS(tsKey);
                }
            } catch (err) {
                node.error(`Error on close: ${err.message}`);
            } finally {
                if (redisCfg) redisCfg.closeClient();
                node.status({});
                done();
            }
        });
    }

    RED.nodes.registerType('uns-spawn', UNS_SpawnNode);
};
