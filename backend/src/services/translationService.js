const translate = require('google-translate-api-x');

/**
 * Service to handle text translation using Google Translate API.
 */
class TranslationService {
    constructor() {
        this.cache = new Map();
        this.inFlight = new Map();
        this.maxCacheEntries = 500;
        this.cacheTtlMs = Number(process.env.TRANSLATION_CACHE_TTL_MS || 6 * 60 * 60 * 1000);
        this.timeoutMs = Number(process.env.TRANSLATION_TIMEOUT_MS || 10000);
        this.failureCooldownMs = Number(process.env.TRANSLATION_COOLDOWN_MS || 30000);
        this.cooldownUntil = 0;
        this.lastErrorLogAt = 0;
        this.errorLogThrottleMs = Number(process.env.TRANSLATION_ERROR_LOG_THROTTLE_MS || 30000);
    }

    buildCacheKey(text, target, source) {
        return `${source}|${target}|${String(text || '').trim()}`;
    }

    getCached(key) {
        const existing = this.cache.get(key);
        if (!existing) return null;
        if (existing.expiresAt <= Date.now()) {
            this.cache.delete(key);
            return null;
        }
        return existing.value;
    }

    setCached(key, value) {
        if (!value) return;
        if (this.cache.size >= this.maxCacheEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + this.cacheTtlMs
        });
    }

    logErrorThrottled(message) {
        const now = Date.now();
        if (now - this.lastErrorLogAt >= this.errorLogThrottleMs) {
            console.warn(`[TranslationService] ${message}`);
            this.lastErrorLogAt = now;
        }
    }

    shouldApplyCooldown(errorMessage = '') {
        const lower = String(errorMessage).toLowerCase();
        return (
            lower.includes('timed out') ||
            lower.includes('etimedout') ||
            lower.includes('econnreset') ||
            lower.includes('enotfound') ||
            lower.includes('network')
        );
    }

    /**
     * Translates text to a target language.
     * @param {string} text - The text to translate.
     * @param {string} target - The target language code (default 'en').
     * @param {string} source - The source language code (default 'auto').
     * @returns {Promise<string>} - The translated text.
     */
    async translate(text, target = 'en', source = 'auto') {
        if (!text || text.trim() === '') {
            return '';
        }

        const key = this.buildCacheKey(text, target, source);
        const cached = this.getCached(key);
        if (cached) return cached;

        if (Date.now() < this.cooldownUntil) {
            throw new Error('Translation temporarily unavailable (cooldown active)');
        }

        if (this.inFlight.has(key)) {
            return this.inFlight.get(key);
        }

        const requestPromise = (async () => {
            try {
                const translatePromise = translate(text, { to: target, from: source });
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Translation timed out after ${Math.floor(this.timeoutMs / 1000)} seconds`)), this.timeoutMs)
                );

                const res = await Promise.race([translatePromise, timeoutPromise]);

                if (res && res.text) {
                    this.setCached(key, res.text);
                    return res.text;
                }

                throw new Error('Empty response from Google Translate');
            } catch (error) {
                const message = error?.message || 'Unknown translation error';
                if (this.shouldApplyCooldown(message)) {
                    this.cooldownUntil = Date.now() + this.failureCooldownMs;
                }
                this.logErrorThrottled(`Error: ${message}`);
                throw new Error(`Translation failed: ${message}`);
            } finally {
                this.inFlight.delete(key);
            }
        })();

        this.inFlight.set(key, requestPromise);
        return requestPromise;
    }
}

module.exports = new TranslationService();
