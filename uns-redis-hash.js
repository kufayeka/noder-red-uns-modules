module.exports = function(RED) {
    function RedisHashCrudNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const redisCfg = RED.nodes.getNode(config.redisConfig);
        if (!redisCfg) {
            node.error("Missing Redis config");
            node.status({ fill: 'red', shape: 'ring', text: 'Missing Redis config' });
            return;
        }
        const client = redisCfg.getClient();

        node.on('input', async (msg, send, done) => {
            try {
                const { operation, key, data, field, pattern } = msg.payload;
                let result;

                if (operation === 'set') {
                    await client.hset(key, data);
                    node.status({ fill: 'green', shape: 'dot', text: `Set ${key}` });
                    result = { status: 'success', key };
                } else if (operation === 'get') {
                    if (field) {
                        result = await client.hget(key, field);
                        result = JSON.parse(result) || result;
                    } else {
                        result = await client.hgetall(key);
                        for (const k in result) {
                            try {
                                result[k] = JSON.parse(result[k]);
                            } catch (e) {}
                        }
                    }
                    node.status({ fill: 'green', shape: 'dot', text: `Get ${key}` });
                } else if (operation === 'del') {
                    if (field) {
                        await client.hdel(key, field);
                    } else {
                        await client.del(key);
                    }
                    node.status({ fill: 'green', shape: 'dot', text: `Deleted ${key}` });
                    result = { status: 'success', key };
                } else if (operation === 'getKeys') {
                    result = await client.keys(pattern || '*');
                    node.status({ fill: 'green', shape: 'dot', text: `Fetched keys for ${pattern}` });
                    result = { status: 'success', keys: result };
                } else if (operation === 'getAll') {
                    const keys = await client.keys(pattern || '*');
                    result = [];
                    for (const k of keys) {
                        const data = await client.hgetall(k);
                        for (const field in data) {
                            try {
                                data[field] = JSON.parse(data[field]);
                            } catch (e) {}
                        }
                        result.push({ key: k, data });
                    }
                    node.status({ fill: 'green', shape: 'dot', text: `Fetched all for ${pattern}` });
                    result = { status: 'success', entries: result };
                } else {
                    throw new Error('Invalid operation');
                }

                msg.payload = result;
                send(msg);
                done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: `Error: ${err.message}` });
                node.error(`Hash CRUD error: ${err.message}`, msg);
                done(err);
            }
        });

        node.on('close', (removed, done) => {
            if (redisCfg) redisCfg.closeClient();
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('uns-redis-hash', RedisHashCrudNode);
};