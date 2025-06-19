module.exports = {
  /**
   * View all UNS entries with values, optional filter by prefix.
   */
  listAllKeysWithValues: async (client, prefix = "") => {
    try {
      // Get all keys at once
      const keys = await client.keys('*');

      if (keys.length === 0) {
        return [];
      }

      // Get all values in one batch operation (lebih efisien)
      const values = await client.mget(keys);

      const results = [];

      // Process each key-value pair
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const raw = values[i];

        // Skip if no value
        if (!raw) continue;

        // Try to parse JSON
        let store;
        try {
          store = JSON.parse(raw);
        } catch (e) {
          // Skip invalid JSON
          continue;
        }

        // Check if store has required structure
        if (!store.metadata || !store.metadata.uns) {
          continue;
        }

        // Filter by prefix if provided
        if (prefix && !store.metadata.uns.startsWith(prefix)) {
          continue;
        }

        // Add to results
        results.push({
          key,
          uns: store.metadata.uns,
          metadata: store.metadata,
          value: store.value
        });
      }

      return results;

    } catch (error) {
      console.error('Error in listAll:', error);
      return [];
    }
  },

  // Basic list all keys
  listKeys: async (client, pattern = "*") => {
    try {
      const keys = await client.keys(pattern);
      return keys;
    } catch (error) {
      console.error('Error listing keys:', error);
      return [];
    }
  },

// List keys dengan prefix filter
  listKeysWithPrefix: async (client, prefix = "") => {
    try {
      const keys = await client.keys('*');

      if (!prefix) {
        return keys;
      }

      // Filter keys yang mengandung prefix
      const filteredKeys = keys.filter(key => key.includes(prefix));
      return filteredKeys;
    } catch (error) {
      console.error('Error listing keys with prefix:', error);
      return [];
    }
  },

// List keys berdasarkan pattern yang lebih spesifik
  listKeysByPattern: async (client, pattern = "*") => {
    try {
      const keys = await client.keys(pattern);
      return keys.sort(); // Return sorted keys
    } catch (error) {
      console.error('Error listing keys by pattern:', error);
      return [];
    }
  },

// List keys dengan informasi tambahan (count, sorted)
  listKeysWithInfo: async (client, pattern = "*") => {
    try {
      const keys = await client.keys(pattern);
      return {
        keys: keys.sort(),
        count: keys.length,
        pattern: pattern
      };
    } catch (error) {
      console.error('Error listing keys with info:', error);
      return {
        keys: [],
        count: 0,
        pattern: pattern
      };
    }
  },

// List keys dengan pagination (untuk database Redis yang besar)
  listKeysWithPagination: async (client, cursor = 0, pattern = "*", count = 100) => {
    try {
      // Menggunakan SCAN untuk performa lebih baik di production
      const result = await client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
      return {
        cursor: result[0], // Next cursor untuk pagination
        keys: result[1],   // Array of keys
        hasMore: result[0] !== '0'
      };
    } catch (error) {
      console.error('Error listing keys with pagination:', error);
      return {
        cursor: '0',
        keys: [],
        hasMore: false
      };
    }
  },

  /**
   * Get one entry (metadata + value).
   */
  getEntry: async (client, key) => {
    const raw = await client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch(e) {
      throw new Error(`Invalid JSON at key ${key}`);
    }
  },

  /**
   * Delete one entry by key.
   */
  deleteEntry: async (client, key) => {
    return await client.del(key);
  },

  /**
   * Delete all entries under a namespace prefix.
   */
  deleteAllNamespace: async (client, prefix) => {
    try {
      // Get all keys at once
      const keys = await client.keys('*');

      if (keys.length === 0) {
        return [];
      }

      // Get all values in batch operation
      const values = await client.mget(keys);

      const keysToDelete = [];
      const deleted = [];

      // Process each key-value pair to find matching namespace
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const raw = values[i];

        // Skip if no value
        if (!raw) continue;

        // Try to parse JSON
        let store;
        try {
          store = JSON.parse(raw);
        } catch (e) {
          // Skip invalid JSON
          continue;
        }

        // Check if store has required structure
        if (!store.metadata || !store.metadata.uns) {
          continue;
        }

        // Check if UNS starts with prefix
        if (store.metadata.uns.startsWith(prefix)) {
          keysToDelete.push(key);
          deleted.push({
            key,
            uns: store.metadata.uns
          });
        }
      }

      // Delete all matching keys in batch if any found
      if (keysToDelete.length > 0) {
        await client.del(...keysToDelete);
      }

      return deleted;

    } catch (error) {
      console.error('Error in deleteAllNamespace:', error);
      return [];
    }
  },

// Alternative version dengan lebih detail info
  deleteAllNamespaceWithInfo: async (client, prefix) => {
    try {
      const keys = await client.keys('*');

      if (keys.length === 0) {
        return {
          deleted: [],
          count: 0,
          prefix: prefix
        };
      }

      const values = await client.mget(keys);
      const keysToDelete = [];
      const deleted = [];

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const raw = values[i];

        if (!raw) continue;

        let store;
        try {
          store = JSON.parse(raw);
        } catch (e) {
          continue;
        }

        if (!store.metadata?.uns) {
          continue;
        }

        if (store.metadata.uns.startsWith(prefix)) {
          keysToDelete.push(key);
          deleted.push({
            key,
            uns: store.metadata.uns,
            metadata: store.metadata
          });
        }
      }

      // Batch delete
      let deletedCount = 0;
      if (keysToDelete.length > 0) {
        deletedCount = await client.del(...keysToDelete);
      }

      return {
        deleted: deleted,
        count: deletedCount,
        prefix: prefix,
        keysProcessed: keys.length
      };

    } catch (error) {
      console.error('Error in deleteAllNamespaceWithInfo:', error);
      return {
        deleted: [],
        count: 0,
        prefix: prefix,
        keysProcessed: 0
      };
    }
  },

// Version dengan confirmation untuk safety
  deleteAllNamespaceWithConfirm: async (client, prefix, confirm = false) => {
    try {
      if (!confirm) {
        throw new Error('Please set confirm=true to proceed with deletion');
      }

      const keys = await client.keys('*');

      if (keys.length === 0) {
        return { message: 'No keys found', deleted: [] };
      }

      const values = await client.mget(keys);
      const keysToDelete = [];
      const deleted = [];

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const raw = values[i];

        if (!raw) continue;

        let store;
        try {
          store = JSON.parse(raw);
        } catch (e) {
          continue;
        }

        if (!store.metadata?.uns) {
          continue;
        }

        if (store.metadata.uns.startsWith(prefix)) {
          keysToDelete.push(key);
          deleted.push({
            key,
            uns: store.metadata.uns
          });
        }
      }

      if (keysToDelete.length === 0) {
        return {
          message: `No entries found with prefix: ${prefix}`,
          deleted: []
        };
      }

      // Batch delete
      const deletedCount = await client.del(...keysToDelete);

      return {
        message: `Successfully deleted ${deletedCount} entries with prefix: ${prefix}`,
        deleted: deleted,
        count: deletedCount
      };

    } catch (error) {
      console.error('Error in deleteAllNamespaceWithConfirm:', error);
      throw error;
    }
  }

};
