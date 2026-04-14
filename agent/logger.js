const { createLogger, format, transports } = require("winston");

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.colorize(),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
      const stack = meta.stack ? `\n${meta.stack}` : "";
      return `[${timestamp}] ${level}: ${message}${metaStr}${stack}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "agent.log", format: format.uncolorize() }),
  ],
});

/**
 * Log a structured error with full context.
 * @param {string} component - Which component (e.g., "judge", "scanner")
 * @param {string} action - What action was being performed
 * @param {Error|object} err - The error object
 * @param {object} [context={}] - Additional context (prNumber, step, etc.)
 */
function logError(component, action, err, context = {}) {
  const errorInfo = {
    component,
    action,
    errorType: err.constructor?.name || "UnknownError",
    errorMessage: err.message || String(err),
    ...(err.status && { statusCode: err.status }),
    ...(err.code && { errorCode: err.code }),
    ...context,
  };

  // Include stack trace for unexpected errors
  const stack = err.stack || "";
  if (stack) {
    errorInfo.stack = stack.split("\n").slice(0, 3).join(" | ");
  }

  logger.error(`${component}: ${action} failed`, errorInfo);
  return errorInfo;
}

module.exports = logger;
module.exports.logError = logError;