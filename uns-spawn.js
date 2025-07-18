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
        const defaultThrottleInterval = parseInt(config.statusThrottleInterval) || 1000;
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

                // 2. Ambil field dari msg langsung, fallback ke config
                const root = msg.root || config.root;
                const org = msg.org || config.org;
                const siteType = msg.siteType || config.siteType;
                const siteName = msg.siteName || config.siteName;
                const subsiteType = msg.subsiteType || config.subsiteType;
                const subsiteName = msg.subsiteName || config.subsiteName;
                const deviceGroup = msg.deviceGroup || config.deviceGroup;
                const deviceName = msg.deviceName || config.deviceName;
                const parameterName = msg.parameterName || config.parameterName;
                const siteId = msg.siteId || config.siteId;
                const deviceId = msg.deviceId || config.deviceId;
                const description = msg.description || config.description;
                const ttl = parseInt(msg.ttl) || parseInt(config.ttl) || 0;
                const statusThrottleInterval = parseInt(msg.statusThrottleInterval) || defaultThrottleInterval;

                // 3. Bangun UNS path
                const parts = [
                    root,
                    org,
                    siteType,
                    siteName
                ];

                if (subsiteType && subsiteName) {
                    parts.push(subsiteType, subsiteName);
                }
                if (deviceGroup) {
                    parts.push(deviceGroup);
                }
                if (deviceName) {
                    parts.push(deviceName);
                }
                parts.push(parameterName);

                const uns = parts.join('/');
                msg.topic = uns;

                const status = msg.status || 'up';

                // 4. Susun payload
                const ts = Date.now();
                const store = {
                    metadata: {
                        root,
                        org,
                        siteType,
                        siteId,
                        subsiteType,
                        deviceGroup,
                        deviceId,
                        parameterName,
                        description,
                        last_update: ts,
                        uns,
                        status
                    },
                    value: data
                };
                msg.payload = store;

                // 5. Simpan ke Redis
                if (ttl > 0) {
                    await client.set(uns, JSON.stringify(store), 'EX', ttl);
                } else {
                    await client.set(uns, JSON.stringify(store));
                }

                msg.metadata = store;
                msg.value = data;

                // 6. Update node.status dengan throttling
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
                node.status({fill: 'red', shape: 'ring', text: `Error: ${err.message}`});
                lastStatusUpdate = Date.now();
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