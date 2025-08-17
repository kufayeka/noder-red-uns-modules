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
        const client = redisCfg.getClient();

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
                    result = await client.keys(pattern || '*');
                    node.status({ fill: 'green', shape: 'dot', text: `Fetched keys for ${pattern}` });
                    result = { status: 'success', keys: result };
                } else if (operation === 'getAll') {
                    const keys = await client.keys(pattern || '*');
                    result = [];
                    for (const k of keys) {
                        const data = JSON.parse(await client.call('JSON.GET', k));
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