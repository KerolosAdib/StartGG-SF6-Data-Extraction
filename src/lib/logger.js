/**
 * Structured logger.
 *
 * When NODE_ENV=production, outputs machine-parseable JSON lines.
 * Otherwise, outputs human-readable lines and also writes to daily
 * log files in /logs.
 */

const fs = require('fs');
const path = require('path');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// File logging (local development only)
// ---------------------------------------------------------------------------
const logsDir = path.join(__dirname, '..', '..', 'logs');
if (!IS_PRODUCTION && !fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function getLogFilePath() {
    const dateStr = new Date().toISOString().split('T')[0];
    return path.join(logsDir, `scraper-${dateStr}.log`);
}

function writeToFile(entry) {
    try {
        fs.appendFileSync(getLogFilePath(), JSON.stringify(entry) + '\n', 'utf8');
    } catch {
        // Silently ignore file write errors
    }
}

// ---------------------------------------------------------------------------
// Core log function
// ---------------------------------------------------------------------------
function log(level, message, meta = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta,
    };

    if (IS_PRODUCTION) {
        // JSON line for CloudWatch
        process.stdout.write(JSON.stringify(entry) + '\n');
    } else {
        // Human-readable console + file
        const metaStr = Object.keys(meta).length
            ? ' ' + JSON.stringify(meta)
            : '';
        const line = `[${entry.timestamp}] [${level}] ${message}${metaStr}`;

        if (level === 'ERROR') console.error(line);
        else if (level === 'WARN') console.warn(line);
        else console.log(line);

        writeToFile(entry);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
const logger = {
    info:  (msg, meta) => log('INFO',  msg, meta),
    warn:  (msg, meta) => log('WARN',  msg, meta),
    error: (msg, meta) => log('ERROR', msg, meta),
    debug: (msg, meta) => log('DEBUG', msg, meta),

    /** Log a stage-level progress summary. */
    progress: (stage, current, total, extra = {}) => {
        log('INFO', `[${stage}] ${current}/${total}`, extra);
    },
};

module.exports = logger;
