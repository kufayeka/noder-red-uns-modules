const Redis = require('ioredis');

const pool = new Map();

function getConnection(id, options) {
    console.log(`[UNS-Redis Pool] Getting connection for ID: ${id}`);

    if (!pool.has(id)) {
        console.log(`[UNS-Redis Pool] Creating new connection for ${id}`);
        console.log(`[UNS-Redis Pool] Options:`, options);

        const client = new Redis({
            ...options,
            maxRetriesPerRequest: null, // unlimited
            retryStrategy: function(times) {
                return Math.min(times * 1000, 30000); // 1s, 2s, 3s, ...max 30s
            },
            enableReadyCheck: true,
            reconnectOnError: function (err) {
                // Kalau errornya connection-related, coba reconnect terus
                const targetErrors = [
                    'READONLY',
                    'ETIMEDOUT',
                    'ECONNRESET',
                    'EPIPE',
                    'ENOENT',
                    'ENOTFOUND',
                ];
                return targetErrors.some(e => err.message.includes(e));

            },
        });


        client.on('connect',     () => console.log(`[UNS-Redis Pool] ${id} - Connected`));
        client.on('ready',       () => console.log(`[UNS-Redis Pool] ${id} - Ready`));
        client.on('error',       err => console.error(`[UNS-Redis Pool] ${id} - Error:`, err.message));
        client.on('close',       () => console.log(`[UNS-Redis Pool] ${id} - Closed`));
        client.on('reconnecting',ms => console.log(`[UNS-Redis Pool] ${id} - Reconnecting in ${ms}ms`));

        pool.set(id, client);
        console.log(`[UNS-Redis Pool] Connection stored. Pool size: ${pool.size}`);
    } else {
        console.log(`[UNS-Redis Pool] Reusing existing connection for ${id}`);
    }

    return pool.get(id);
}

function closeConnection(id) {
    console.log(`[UNS-Redis Pool] Closing connection for ID: ${id}`);
    if (pool.has(id)) {
        pool.get(id).disconnect();
        pool.delete(id);
        console.log(`[UNS-Redis Pool] Connection closed. Pool size: ${pool.size}`);
    } else {
        console.log(`[UNS-Redis Pool] No connection found for ID: ${id}`);
    }
}

function getAllConnectionIds() {
    return Array.from(pool.keys());
}

function getConnectionStatus(id) {
    return pool.has(id) ? pool.get(id).status : 'not_found';
}

module.exports = {
    getConnection,
    closeConnection,
    getAllConnectionIds,
    getConnectionStatus
};
