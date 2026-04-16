/**
 * Enhanced Logger for AI Judge Module
 * 
 * Provides structured logging with:
 * - ISO timestamps
 * - Log levels (debug/info/warn/error)
 * - Error stack traces
 * - Review metrics tracking
 * - JSON output option for CI integration
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];
const isJson = process.env.LOG_FORMAT === 'json';

// Metrics tracking
const metrics = {
  reviewsTotal: 0,
  reviewsPassed: 0,
  reviewsFailed: 0,
  reviewsError: 0,
  totalDurationMs: 0,
  apiCalls: 0,
  apiErrors: 0,
};

function formatMsg(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  if (isJson) {
    return JSON.stringify({ timestamp, level, message, ...data });
  }
  const dataStr = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

function log(level, message, data = {}) {
  if (LOG_LEVELS[level] < currentLevel) return;
  const formatted = formatMsg(level, message, data);
  if (level === 'error') console.error(formatted);
  else if (level === 'warn') console.warn(formatted);
  else console.log(formatted);
}

module.exports = {
  debug: (msg, data) => log('debug', msg, data),
  info: (msg, data) => log('info', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  error: (msg, data) => {
    if (data.error instanceof Error) {
      data.error = { message: data.error.message, stack: data.error.stack };
    }
    log('error', msg, data);
  },

  // Review-specific logging
  reviewStart(prNumber) {
    metrics.reviewsTotal++;
    const startTime = Date.now();
    this.info(`Review started for PR #${prNumber}`, { prNumber, startTime });
    return { prNumber, startTime };
  },

  reviewEnd(ctx, verdict, reason) {
    const durationMs = Date.now() - ctx.startTime;
    metrics.totalDurationMs += durationMs;
    if (verdict === 'PASS') metrics.reviewsPassed++;
    else if (verdict === 'FAIL') metrics.reviewsFailed++;
    else metrics.reviewsError++;
    this.info(`Review complete: PR #${ctx.prNumber} -> ${verdict}`, {
      prNumber: ctx.prNumber,
      verdict,
      reason,
      durationMs,
    });
  },

  apiCall(endpoint) {
    metrics.apiCalls++;
    this.debug(`API call: ${endpoint}`, { endpoint });
  },

  apiError(endpoint, error) {
    metrics.apiErrors++;
    this.error(`API error: ${endpoint}`, { endpoint, error });
  },

  // Get metrics summary
  getMetrics() {
    return {
      ...metrics,
      avgDurationMs: metrics.reviewsTotal > 0
        ? Math.round(metrics.totalDurationMs / metrics.reviewsTotal)
        : 0,
    };
  },

  // Print metrics summary
  printMetrics() {
    const m = this.getMetrics();
    this.info('=== Review Metrics ===', m);
  },
};
