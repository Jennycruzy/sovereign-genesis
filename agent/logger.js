const { createLogger, format, transports } = require("winston");
const crypto = require("crypto");

/**
 * Generate a short correlation ID for tracing related log entries
 * across async operations.
 */
function generateCorrelationId() {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Custom Winston format that outputs structured JSON in production
 * and human-readable text in development.
 */
const structuredFormat = format.combine(
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.errors({ stack: true }), // capture stack traces
  format((info) => {
    // Attach correlation ID if provided via meta
    if (info.correlationId) {
      info.correlationId = info.correlationId;
    }
    return info;
  })(),
  process.env.NODE_ENV === "production"
    ? format.json()
    : format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, stack, ...meta }) => {
          let log = `[${timestamp}] ${level}: ${message}`;
          if (stack) log += `\n  Stack: ${stack}`;
          // Append metadata fields (excluding internal winston keys)
          const metaKeys = Object.keys(meta).filter(
            (k) => !["timestamp", "level", "message"].includes(k)
          );
          if (metaKeys.length > 0) {
            const metaStr = metaKeys
              .map((k) => `${k}=${JSON.stringify(meta[k])}`)
              .join(", ");
            log += ` | ${metaStr}`;
          }
          return log;
        })
      )
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: structuredFormat,
  transports: [
    new transports.Console(),
    new transports.File({
      filename: "agent.log",
      format: format.combine(format.uncolorize(), format.json()),
    }),
  ],
});

/**
 * Log a structured error with full context.
 * @param {string} message - Human-readable error description
 * @param {Error|null} err - The caught error (optional)
 * @param {object} context - Additional metadata (prNumber, operation, statusCode, etc.)
 */
logger.logError = function (message, err = null, context = {}) {
  const entry = {
    ...context,
    errorType: err?.constructor?.name || "Unknown",
    errorCode: err?.code || err?.status || undefined,
    errorMessage: err?.message || undefined,
    stack: err?.stack || undefined,
  };
  // Remove undefined fields to keep logs clean
  Object.keys(entry).forEach(
    (k) => entry[k] === undefined && delete entry[k]
  );
  this.error(message, entry);
};

/**
 * Log a structured warning with context.
 */
logger.logWarn = function (message, context = {}) {
  this.warn(message, context);
};

/**
 * Log a structured info entry with context.
 */
logger.logInfo = function (message, context = {}) {
  this.info(message, context);
};

module.exports = logger;
module.exports.generateCorrelationId = generateCorrelationId;
