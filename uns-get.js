module.exports = function(RED) {
    const crud = require('./redis/redis-uns-manager');
    function UNSGetNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const redisCfg = RED.nodes.getNode(config.redisConfig);
        if (!redisCfg) {
            node.error("Missing Redis config");
            return;
        }
        const client = redisCfg.getClient();

        // Tangani event Redis untuk status
        client.on('ready', () => node.status({fill:'green',shape:'dot',text:'Redis connected'}));
        client.on('error', err => node.status({fill:'red',shape:'ring',text:'Redis error'}));
        client.on('reconnecting', (ms) => node.status({fill:'yellow',shape:'ring',text:`Redis reconnecting(${ms})`}));
        client.on('close', () => node.status({}));

        node.on('input', async (msg, send, done) => {
            try {
                const key = config.key || msg.key;
                if (!key) throw new Error("No key provided");
                const store = await crud.getEntry(client, key);
                if (!store) { msg.payload = null; send(msg); return done(); }
                msg.topic = store.metadata.uns;
                msg.payload = config.fetchMode === 'value' ? store.value : { metadata: store.metadata, value: store.value };
                send(msg);
                // Update node.status dengan UNS dan value
                node.status({
                    fill: 'green',
                    shape: 'dot',
                    text: `value: ${store.value} | uns: ${store.metadata.uns}`
                });

                done();
            } catch (err) {
                node.error(err, msg);
                done();
            }
        });
    }
    RED.nodes.registerType('uns-get', UNSGetNode);
};