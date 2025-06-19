const crud = require("./redis/redis-uns-manager");
module.exports = function(RED) {
    const crud = require('./redis/redis-uns-manager');
    function UNSDeleteNamespaceNode(config) {
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
                const prefix = config.namespacePrefix;
                if (!prefix) throw new Error("No namespace prefix provided");
                const count = await crud.deleteAllNamespace(client, prefix);
                msg.payload = { deleted: count.length };
                send(msg);

                // Update node.status dengan UNS dan value
                node.status({
                    fill: 'green',
                    shape: 'dot',
                    text: `deleted: ${count.length}`
                });

                done();
            } catch (err) {
                node.error(err, msg);
                done();
            }
        });
    }
    RED.nodes.registerType('uns-delete-namespace', UNSDeleteNamespaceNode);
};