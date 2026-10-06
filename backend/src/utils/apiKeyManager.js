/**
 * ApiKeyManager.js
 * 
 * Manages multiple API keys for high-volume services (Groq).
 * Implements round-robin selection and basic 429 failover.
 */

class ApiKeyManager {
    constructor() {
        this.keys = {
            GROQ: this._parseKeys(process.env.GROQ_API_KEYS) || [process.env.GROQ_API_KEY]
        };
        this.indices = {
            GROQ: 0
        };
        this.blacklisted = new Map(); // key -> resumeTimestamp
    }

    _parseKeys(keyString) {
        if (!keyString) return null;
        return keyString.split(',').map(k => k.trim()).filter(Boolean);
    }

    /**
     * Get the next available key for a service.
     * Skips blacklisted keys.
     */
    getNextKey(service) {
        const serviceKeys = this.keys[service];
        if (!serviceKeys || serviceKeys.length === 0) return null;

        const now = Date.now();
        let checkedCount = 0;

        while (checkedCount < serviceKeys.length) {
            const key = serviceKeys[this.indices[service]];

            // Check if blacklisted
            const resumeAt = this.blacklisted.get(key);
            if (!resumeAt || now >= resumeAt) {
                if (resumeAt) this.blacklisted.delete(key); // Cleanup

                // Move index for next call
                this.indices[service] = (this.indices[service] + 1) % serviceKeys.length;
                return key;
            }

            // Move to next key
            this.indices[service] = (this.indices[service] + 1) % serviceKeys.length;
            checkedCount++;
        }

        // Fallback to first key if all are blacklisted (desperate measure)
        console.warn(`[ApiKeyManager] All keys for ${service} are currently blacklisted. Retrying first key.`);
        return serviceKeys[0];
    }

    /**
     * Mark a key as exhausted (429) for a specific duration.
     */
    markExhausted(key, durationMs = 10 * 60 * 1000) {
        console.warn(`[ApiKeyManager] Blacklisting key ${key.substring(0, 8)}... for ${durationMs / 1000}s`);
        this.blacklisted.set(key, Date.now() + durationMs);
    }

    getStats() {
        return {
            total: Object.keys(this.keys).reduce((acc, s) => ({ ...acc, [s]: this.keys[s].length }), {}),
            blacklisted: this.blacklisted.size
        };
    }
}

// Singleton instance
module.exports = new ApiKeyManager();
