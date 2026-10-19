/**
 * Queue-based rate limiter.
 * Ensures a minimum interval between consecutive requests,
 * even when many callers invoke acquire() concurrently.
 *
 * Callers are queued in FIFO order and released one at a time
 * with the configured delay between each.
 */

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class RateLimiter {
    /**
     * @param {number} requestsPerSecond - Max requests per second (can be < 1).
     */
    constructor(requestsPerSecond) {
        this.minIntervalMs = 1000 / requestsPerSecond;
        this.nextAvailableTime = 0;
    }

    /**
     * Wait until it's safe to make the next request.
     * Concurrent callers are serialized — each one reserves a
     * time slot and waits until that slot arrives.
     */
    async acquire() {
        const now = Date.now();

        // Reserve the next available slot
        const scheduledTime = Math.max(this.nextAvailableTime, now);
        this.nextAvailableTime = scheduledTime + this.minIntervalMs;

        // Wait until our reserved slot
        const waitMs = scheduledTime - now;
        if (waitMs > 0) {
            await sleep(waitMs);
        }
    }
}

module.exports = { RateLimiter, sleep };
