module.exports = function(RED) {
    function UNS_SpawnNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Ambil Redis client dari config-node
        const redisCfg = RED.nodes.getNode(config.redisConfig);
        if (!redisCfg) {
            node.error("Missing Redis config");
            node.status({fill: 'red', shape: 'ring', text: 'Missing Redis config'});
            return;
        }
        const client = redisCfg.getClient();

        // Tangani event Redis untuk status
        client.on('ready', () => node.status({fill: 'green', shape: 'dot', text: 'Redis connected'}));
        client.on('error', err => node.status({fill: 'red', shape: 'ring', text: `Redis error: ${err.message}`}));
        client.on('reconnecting', ms => node.status({fill: 'yellow', shape: 'ring', text: `Reconnecting (${ms}ms)`}));
        client.on('close', () => node.status({}));

        // Throttle interval untuk status update (dalam ms)
        const throttleInterval = parseInt(config.statusThrottleInterval) || 1000;
        let lastStatusUpdate = 0;

        node.on('input', async function(msg, send, done) {
            try {
                // 1. Ambil data
                let data;
                switch(config.dataSourceType) {
                    case 'flow':
                        data = node.context().flow.get(config.dataSource);
                        break;
                    case 'global':
                        data = node.context().global.get(config.dataSource);
                        break;
                    default:
                        data = RED.util.getMessageProperty(msg, config.dataSource);
                }

                // 2. Bangun UNS path
                const parts = [
                    config.root,
                    config.org,
                    config.siteType,
                    config.siteName
                ];

                if (config.subsiteType && config.subsiteName) {
                    parts.push(config.subsiteType, config.subsiteName);
                }
                if (config.deviceGroup) {
                    parts.push(config.deviceGroup);
                }
                if (config.deviceName) {
                    parts.push(config.deviceName);
                }
                parts.push(config.parameterName);

                const uns = parts.join('/');
                msg.topic = uns;

                const status = msg.status;

                // 3. Susun payload
                const ts = Date.now();
                const store = {
                    metadata: {
                        root:         config.root,
                        org:          config.org,
                        siteType:     config.siteType,
                        siteId:       config.siteId,
                        subsiteType:  config.subsiteType,
                        deviceGroup:  config.deviceGroup,
                        deviceId:     config.deviceId,
                        parameterName: config.parameterName,
                        description:  config.description,
                        last_update:  ts,
                        uns: uns,
                        status: status || "up"
                    },
                    value: data
                };
                msg.payload = store;

                // 4. Simpan ke Redis
                const ttl = parseInt(config.ttl) || 0;
                if (ttl > 0) {
                    await client.set(uns, JSON.stringify(store), "EX", ttl);
                } else {
                    await client.set(uns, JSON.stringify(store));
                }

                msg.metadata = store;
                msg.value = data;

                // 5. Update node.status dengan throttling
                const now = Date.now();
                if (now - lastStatusUpdate >= throttleInterval) {
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
                node.status({fill: 'red', shape: 'ring', text: `Error: ${err.message}`});
                lastStatusUpdate = Date.now(); // Update timestamp untuk status error
                node.error(err.message, msg);
                done(err);
            }
        });

        node.on('close', function(done) {
            node.status({});
            if (redisCfg) {
                redisCfg.closeClient();
            }
            done();
        });
    }

    RED.nodes.registerType('uns-spawn', UNS_SpawnNode);
};