module.exports = function(RED) {
    const poolMgr = require('./redis/redis-pool-manager');
    const unsMgr = require('./redis/redis-uns-manager');

    function UNSRedisConfigNode(config) {
        RED.nodes.createNode(this, config);
        this.name     = config.name;
        this.host     = config.host;
        this.port     = parseInt(config.port, 10);
        this.password = this.credentials.password || undefined;
        this.poolId   = this.id;


        this.options = {
            host: this.host,
            port: this.port,
            password: this.password
        };

        // RED.httpAdmin.get("/uns/list", async (req, res) => {
        //     try {
        //         const redisConfigId = req.query.redisConfigId;
        //         if (!redisConfigId) return res.status(400).json({error: "No redisConfigId"});
        //         const redisConfig = RED.nodes.getNode(redisConfigId);
        //         if (!redisConfig) return res.status(404).json({error: "Redis config not found"});
        //         const client = redisConfig.getClient();
        //         const keyList = await unsMgr.listKeys(client, "*");
        //         res.json(keyList);
        //     } catch (err) {
        //         RED.log.error("UNS list error: " + err.message);
        //         res.status(500).json({error: err.message});
        //     }
        // });

        RED.httpAdmin.get("/uns/list", async (req, res) => {
            try {
                const redisConfigId = req.query.redisConfigId;
                const unsPrefix = req.query.unsPrefix || "";
                if (!redisConfigId) return res.status(400).json({error: "No redisConfigId"});
                const redisConfig = RED.nodes.getNode(redisConfigId);
                if (!redisConfig) return res.status(404).json({error: "Redis config not found"});
                const client = redisConfig.getClient();
                const allEntries = await unsMgr.listAllKeysWithValues(client, unsPrefix);
                const filteredUNSList = allEntries.map(e => e.uns);
                res.json(filteredUNSList);
            } catch (err) {
                RED.log.error("UNS list error: " + err.message);
                res.status(500).json({error: err.message});
            }
        });



        RED.httpAdmin.get("/uns/clear", async (req, res) => {
            try {
                const redisConfigId = req.query.redisConfigId;
                if (!redisConfigId) return res.status(400).json({error: "No redisConfigId"});
                const redisConfig = RED.nodes.getNode(redisConfigId);
                if (!redisConfig) return res.status(404).json({error: "Redis config not found"});
                const client = redisConfig.getClient();
                await unsMgr.deleteAllNamespace(client, "uns");
                res.sendStatus(200);
            } catch (error) {
                RED.log.error("Clear error: " + error.message);
                res.sendStatus(500);
            }
        });

        this.getClient = () => poolMgr.getConnection(this.poolId, this.options);
        this.closeClient = () => poolMgr.closeConnection(this.poolId);

        this.on('close', (removed, done) => {
            this.closeClient();
            done();
        });
    }

    RED.nodes.registerType('uns-redis-config', UNSRedisConfigNode, {
        credentials: {
            password: { type: "password" }
        }
    });
};
