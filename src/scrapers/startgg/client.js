/**
 * start.gg GraphQL API client with rate limiting and retry.
 */

const { STARTGG } = require('../../config');
const { RateLimiter } = require('../../lib/rateLimiter');
const { withRetry, isTransientError } = require('../../lib/retry');
const { sleep } = require('../../lib/rateLimiter');
const logger = require('../../lib/logger');

class StartGGClient {
    constructor(authToken) {
        if (!authToken) {
            throw new Error('Missing START_GG_AUTH_TOKEN environment variable.');
        }
        this.authToken = authToken;
        this.rateLimiter = new RateLimiter(STARTGG.requestsPerSecond);
        this.maxComplexitySeen = 0;
        this.totalRequests = 0;
    }

    /**
     * Execute a GraphQL query against start.gg.
     *
     * Handles:
     *   - Rate limiting (waits for token)
     *   - Retry on 429 / 5xx / network errors
     *   - Waiting out start.gg outages (see waitForRecovery)
     *   - Response validation
     *   - Complexity tracking
     *
     * @param {string} query     - GraphQL query string.
     * @param {Object} variables - Query variables.
     * @param {string} label     - Label for logging.
     * @returns {Promise<Object>} The `data` field from the response.
     */
    async query(query, variables, label = 'query') {
        for (;;) {
            try {
                return await this.queryWithRetry(query, variables, label);
            } catch (err) {
                if (!isTransientError(err)) throw err;

                // If start.gg answers a minimal query, it's up and this
                // query itself is the problem, so let the caller handle it
                if (await this.isApiUp()) throw err;

                const recovered = await this.waitForRecovery(label);
                if (!recovered) {
                    err.outage = true;
                    throw err;
                }
            }
        }
    }

    /**
     * Wait for start.gg to respond again, checking once per probe interval
     * up to the configured limit.
     * @returns {Promise<boolean>} true if it recovered in time.
     */
    async waitForRecovery(label) {
        const { probeIntervalSeconds, maxWaitMinutes } = STARTGG.outage;
        const deadline = Date.now() + maxWaitMinutes * 60 * 1000;

        logger.warn(`start.gg appears to be unreachable, waiting up to ${maxWaitMinutes} minutes`, { label });
        while (Date.now() < deadline) {
            await sleep(probeIntervalSeconds * 1000);
            if (await this.isApiUp()) {
                logger.info('start.gg is reachable again, resuming', { label });
                return true;
            }
        }
        logger.error(`start.gg still unreachable after ${maxWaitMinutes} minutes`, { label });
        return false;
    }

    /** Send a minimal query; true if start.gg answers it. */
    async isApiUp() {
        await this.rateLimiter.acquire();
        try {
            const res = await fetch(STARTGG.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`,
                },
                body: JSON.stringify({ query: 'query { currentUser { id } }' }),
                signal: AbortSignal.timeout(15000),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    async queryWithRetry(query, variables, label) {
        await this.rateLimiter.acquire();
        this.totalRequests++;

        return withRetry(async () => {
            const res = await fetch(STARTGG.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`,
                },
                body: JSON.stringify({ query, variables }),
                signal: AbortSignal.timeout(300000), // 30s timeout
            });

            if (res.status === 429) {
                const err = new Error('start.gg rate limit exceeded');
                err.status = 429;
                throw err;
            }

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                const err = new Error(`start.gg HTTP ${res.status}: ${body.slice(0, 200)}`);
                err.status = res.status;
                throw err;
            }

            const json = await res.json();

            // GraphQL-level errors (bad query, invalid variables, etc.)
            if (json.errors && !json.data) {
                const messages = json.errors.map((e) => e.message).join('; ');
                const err = new Error(`start.gg GraphQL error: ${messages}`);
                err.status = 400; // Non-retryable
                throw err;
            }

            // Track complexity
            if (json.extensions?.queryComplexity) {
                const complexity = json.extensions.queryComplexity;
                this.maxComplexitySeen = Math.max(this.maxComplexitySeen, complexity);
                if (complexity > STARTGG.maxQueryComplexity) {
                    logger.warn(`Query complexity ${complexity} exceeds safe threshold`, {
                        label,
                        threshold: STARTGG.maxQueryComplexity,
                    });
                }
            }

            return json.data;
        }, {
            maxRetries: 5,
            baseDelay: 2000,
            label: `start.gg:${label}`,
            context: { query, variables },
        });
    }

    getStats() {
        return {
            totalRequests: this.totalRequests,
            maxComplexitySeen: this.maxComplexitySeen,
        };
    }
}

module.exports = StartGGClient;
