/**
 * Retry wrapper with exponential backoff and jitter.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { sleep } = require('./rateLimiter');

const failedQueryDir = path.join(__dirname, '..', '..', 'logs', 'failed-queries');
if (!fs.existsSync(failedQueryDir)) {
    fs.mkdirSync(failedQueryDir, { recursive: true });
}

class RetryableError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'RetryableError';
        this.status = status;
    }
}

/**
 * Execute `fn` with automatic retries on transient failures.
 *
 * Retries on:
 *   - HTTP 429 (rate limited)
 *   - HTTP 5xx (server errors)
 *   - Network errors (fetch failures)
 *
 * Does NOT retry on:
 *   - HTTP 4xx (except 429) — these are client bugs
 *   - GraphQL-level errors — these indicate bad queries
 *
 * @param {Function} fn        - Async function to execute.
 * @param {Object}   options
 * @param {number}   options.maxRetries  - Maximum retry attempts (default 5).
 * @param {number}   options.baseDelay   - Initial delay in ms (default 2000).
 * @param {number}   options.maxDelay    - Ceiling for delay in ms (default 60000).
 * @param {string}   options.label       - Label for log messages.
 * @param {Object}   options.context     - Context to write to file on final failure (e.g. { query, variables }).
 * @returns {Promise<*>} Result of fn().
 */
async function withRetry(fn, options = {}) {
    const {
        maxRetries = 5,
        baseDelay = 2000,
        maxDelay = 60000,
        label = 'operation',
        context = null,
    } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            const isLastAttempt = attempt === maxRetries;

            // Don't retry client errors (except 429)
            if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
                throw err;
            }

            if (isLastAttempt) {
                logger.error(`${label}: all ${maxRetries} retries exhausted`, {
                    error: err.message,
                });

                // Write failed query context to file for debugging
                if (context) {
                    try {
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const filePath = path.join(failedQueryDir, `${safeLabel}_${timestamp}.txt`);
                        const content = [
                            `Failed Query — ${label}`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Error: ${err.message}`,
                            `Status: ${err.status || 'N/A'}`,
                            `Retries Exhausted: ${maxRetries}`,
                            '',
                            '--- Query ---',
                            context.query || 'N/A',
                            '',
                            '--- Variables ---',
                            JSON.stringify(context.variables, null, 2) || 'N/A',
                        ].join('\n');
                        fs.writeFileSync(filePath, content, 'utf8');
                        logger.error(`${label}: failed query written to ${filePath}`);
                    } catch (writeErr) {
                        logger.error(`${label}: failed to write query to file`, {
                            error: writeErr.message,
                        });
                    }
                }

                throw err;
            }

            // Exponential backoff with jitter
            const jitter = Math.random() * 1000;
            const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, maxDelay);

            logger.warn(`${label}: attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms`, {
                error: err.message,
                status: err.status,
            });

            await sleep(delay);
        }
    }
}

/**
 * Whether an error may clear up on its own: network errors, timeouts,
 * 429s and 5xx responses.
 */
function isTransientError(err) {
    return err.status === undefined || err.status === 429 || err.status >= 500;
}

module.exports = { withRetry, RetryableError, isTransientError };
