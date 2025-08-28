module.exports = function(RED) {
    function RedisJsonCrudNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const redisCfg = RED.nodes.getNode(config.redisConfig);
        if (!redisCfg) {
            node.error("Missing Redis config");
            node.status({ fill: 'red', shape: 'ring', text: 'Missing Redis config' });
            return;
        }
        const client = redisCfg.getClient(); // ioredis client

        // helper buat cek reference
        async function resolveReferences(obj) {
            const populated = {};
            for (const [key, val] of Object.entries(obj)) {
                if (typeof val === 'string' && val.startsWith('reference/')) {
                    try {
                        const hashData = await client.hgetall(val);
                        if (hashData && Object.keys(hashData).length > 0) {
                            const parsed = {};
                            for (const [hKey, hVal] of Object.entries(hashData)) {
                                try {
                                    parsed[hKey] = JSON.parse(hVal);
                                } catch {
                                    parsed[hKey] = hVal;
                                }
                            }
                            populated[key] = parsed;
                        } else {
                            populated[key] = {};
                        }
                    } catch (e) {
                        populated[key] = {};
                    }
                }
            }
            return populated;
        }

        node.on('input', async (msg, send, done) => {
            try {
                const { operation, key, path = '.', value, pattern } = msg.payload;
                let result;

                if (operation === 'set') {
                    await client.call('JSON.SET', key, path, JSON.stringify(value));
                    node.status({ fill: 'green', shape: 'dot', text: `Set ${key}` });
                    result = { status: 'success', key };

                } else if (operation === 'get') {
                    result = await client.call('JSON.GET', key, path);
                    result = JSON.parse(result) || result;
                    node.status({ fill: 'green', shape: 'dot', text: `Get ${key}` });

                } else if (operation === 'del') {
                    await client.call('JSON.DEL', key, path);
                    node.status({ fill: 'green', shape: 'dot', text: `Deleted ${key}` });
                    result = { status: 'success', key };

                } else if (operation === 'getKeys') {
                    const keys = await client.keys(pattern || '*');
                    node.status({ fill: 'green', shape: 'dot', text: `Fetched keys for ${pattern}` });
                    result = { status: 'success', keys };

                } else if (operation === 'getAll') {
                    const keys = await client.keys(pattern || '*');
                    const entries = [];
                    for (const k of keys) {
                        const data = JSON.parse(await client.call('JSON.GET', k));
                        entries.push({ key: k, data });
                    }
                    node.status({ fill: 'green', shape: 'dot', text: `Fetched all for ${pattern}` });
                    result = { status: 'success', entries };

                } else if (operation === 'getPopulated') {
                    const data = JSON.parse(await client.call('JSON.GET', key, path));
                    const populated = await resolveReferences(data.schedule_data || {});
                    result = { status: 'success', key, data, populated };
                    node.status({ fill: 'green', shape: 'dot', text: `GetPopulated ${key}` });

                } else if (operation === 'getAllPopulated') {
                    const pattern = msg.payload.pattern || '*';
                    const keys = await client.keys(pattern);
                    const entries = [];

                    for (const k of keys) {
                        try {
                            const raw = await client.call('JSON.GET', k);
                            if (!raw) continue; // skip kalau gak ada JSON

                            const data = JSON.parse(raw);
                            const populated = await resolveReferences(data.schedule_data || {});
                            entries.push({ key: k, data, populated });
                        } catch (err) {
                            node.warn(`Skip key ${k}: ${err.message}`);
                        }
                    }

                    result = { status: 'success', entries };
                } else {
                    throw new Error('Invalid operation');
                }

                msg.payload = result;
                send(msg);
                done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: `Error: ${err.message}` });
                node.error(`JSON CRUD error: ${err.message}`, msg);
                done(err);
            }
        });

        node.on('close', (removed, done) => {
            if (redisCfg) redisCfg.closeClient();
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('uns-redis-json', RedisJsonCrudNode);
};
