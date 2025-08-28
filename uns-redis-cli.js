module.exports = function(RED) {
    function RedisCLINode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const redisCfg = RED.nodes.getNode(config.redisConfig);
        if (!redisCfg) {
            node.error("Missing Redis config");
            node.status({ fill: 'red', shape: 'ring', text: 'Missing Redis config' });
            return;
        }

        const client = redisCfg.getClient();

        client.on('ready', () => {
            node.status({ fill: 'green', shape: 'dot', text: 'Redis connected' });
        });

        node.on('input', async (msg, send, done) => {
            try {
                if (!msg.payload) {
                    throw new Error("msg.payload must be a Redis command array, e.g. ['GET','key']");
                }
                if (!Array.isArray(msg.payload)) {
                    throw new Error("msg.payload must be an array of redis-cli arguments");
                }

                const [command, ...args] = msg.payload;

                // 🔥 eksekusi command via redis.call
                const result = await client.call(command, ...args);

                msg.payload = result;

                node.status({ fill: 'blue', shape: 'dot', text: `${command} ${args.join(' ')}` });

                send(msg);
                done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: `Error: ${err.message}` });
                node.error(err.message, msg);
                done(err);
            }
        });

        node.on('close', (removed, done) => {
            try {
                if (redisCfg) redisCfg.closeClient();
                node.status({});
            } catch (err) {
                node.error(`Error on close: ${err.message}`);
            } finally {
                done();
            }
        });
    }

    RED.nodes.registerType('redis-cli', RedisCLINode);
};
