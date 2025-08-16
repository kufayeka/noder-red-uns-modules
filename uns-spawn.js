module.exports = function(RED) {
    function UNS_SpawnNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Ambil Redis client dari config-node
        const redisCfg = RED.nodes.getNode(config.redisConfig);
        if (!redisCfg) {
            node.error("Missing Redis config");
            node.status({ fill: 'red', shape: 'ring', text: 'Missing Redis config' });
            return;
        }
        const client = redisCfg.getClient();

        // Tangani event Redis
        client.on('ready', () => node.status({ fill: 'green', shape: 'dot', text: 'Redis connected' }));
        client.on('error', err => node.status({ fill: 'red', shape: 'ring', text: `Redis error: ${err.message}` }));
        client.on('reconnecting', ms => node.status({ fill: 'yellow', shape: 'ring', text: `Reconnecting (${ms}ms)` }));
        client.on('close', () => node.status({}));

        const defaultThrottleInterval = parseInt(config.statusThrottleInterval) || 1000;
        let lastStatusUpdate = 0;

        // Track TS key buat delete nanti
        let tsKey = null;

        async function createTSIfNotExist(uns) {
            tsKey = `hist:${uns}`;
            try {
                await client.ts.create(tsKey, {
                    RETENTION: parseInt(config.historianRetention) || 86400000,
                    LABELS: { type: 'historian', uns }
                });
                node.warn(`TimeSeries created: ${tsKey}`);
            } catch (err) {
                if (err.message.includes('TSDB: key already exists')) {
                    node.warn(`TimeSeries already exists: ${tsKey}`);
                } else {
                    node.error(`TS create error: ${err.message}`);
                }
            }
        }

        node.on('input', async function(msg, send, done) {
            try {
                // Ambil data dari msg/flow/global
                let data;
                switch (config.dataSourceType) {
                    case 'flow':
                        data = node.context().flow.get(config.dataSource);
                        break;
                    case 'global':
                        data = node.context().global.get(config.dataSource);
                        break;
                    default:
                        data = RED.util.getMessageProperty(msg, config.dataSource);
                }

                // Ambil field lain
                const root = msg.root || config.root;
                const org = msg.org || config.org;
                const siteType = msg.siteType || config.siteType;
                const siteName = msg.siteName || config.siteName;
                const subsiteType = msg.subsiteType || config.subsiteType;
                const subsiteName = msg.subsiteName || config.subsiteName;
                const deviceGroup = msg.deviceGroup || config.deviceGroup;
                const deviceName = msg.deviceName || config.deviceName;
                const parameterName = msg.parameterName || config.parameterName;
                const description = msg.description || config.description;
                const ttl = parseInt(msg.ttl) || parseInt(config.ttl) || 0;
                const statusThrottleInterval = parseInt(msg.statusThrottleInterval) || defaultThrottleInterval;

                // Build UNS
                const parts = [root, org, siteType, siteName];
                if (subsiteType && subsiteName) parts.push(subsiteType, subsiteName);
                if (deviceGroup) parts.push(deviceGroup);
                if (deviceName) parts.push(deviceName);
                parts.push(parameterName);
                const uns = parts.join('/');
                msg.topic = uns;

                const status = msg.status || 'up';
                const ts = Date.now();
                const store = {
                    metadata: {
                        root,
                        org,
                        siteType,
                        siteId: msg.siteId || config.siteId,
                        subsiteType,
                        deviceGroup,
                        deviceId: msg.deviceId || config.deviceId,
                        parameterName,
                        description,
                        last_update: ts,
                        uns,
                        status
                    },
                    value: data
                };
                msg.payload = store;
                msg.metadata = store;
                msg.value = data;

                // Simpan ke Redis key biasa
                if (ttl > 0) {
                    await client.set(uns, JSON.stringify(store), 'EX', ttl);
                } else {
                    await client.set(uns, JSON.stringify(store));
                }

                // --- Historian ---
                if (config.enableHistorian) {
                    if (!tsKey) await createTSIfNotExist(uns);

                    // Ambil timestamp dari msg/flow/global
                    let tsHist;
                    if (config.historianTimestamp) {
                        switch (config.historianTimestampType) {
                            case 'flow':
                                tsHist = node.context().flow.get(config.historianTimestamp);
                                break;
                            case 'global':
                                tsHist = node.context().global.get(config.historianTimestamp);
                                break;
                            default:
                                tsHist = RED.util.getMessageProperty(msg, config.historianTimestamp);
                        }
                    }
                    if (!tsHist) tsHist = Date.now();

                    await client.ts.add(tsKey, tsHist, data);
                }

                // Update node.status
                const now = Date.now();
                if (now - lastStatusUpdate >= statusThrottleInterval) {
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: `value: ${data} | uns: ${uns}`
                    });
                    lastStatusUpdate = now;
                }

                send(msg);
                done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: `Error: ${err.message}` });
                lastStatusUpdate = Date.now();
                node.error(err.message, msg);
                done(err);
            }
        });

        node.on('close', async function(done) {
            node.status({});
            if (tsKey) {
                try {
                    await client.del(tsKey);
                    node.warn(`TimeSeries deleted: ${tsKey}`);
                } catch (err) {
                    node.error(`Error deleting TS: ${err.message}`);
                }
            }
            if (redisCfg) {
                redisCfg.closeClient();
            }
            done();
        });
    }

    RED.nodes.registerType('uns-spawn', UNS_SpawnNode);
};
