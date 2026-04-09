const { createLogger, format, transports } = require("winston");
const path = require("path");
const fs = require("fs");

// Ensure logs directory exists for structured error log
const LOG_DIR = path.resolve(__dirname, "../logs");
if (!fs.existsSync(LOG_DIR)) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

const logFormat = format.printf(({ timestamp, level, message, module, severity, ...meta }) => {
  const moduleTag = module ? ` [${module}]` : "";
  const severityTag = severity ? ` <${severity}>` : "";
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `[${timestamp}]${moduleTag} ${level}${severityTag}: ${message}${metaStr}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    logFormat
  ),
  transports: [
    new transports.Console({ format: format.combine(format.colorize(), logFormat) }),
    new transports.File({
      filename: path.join(LOG_DIR, "agent.log"),
      format: format.uncolorize(),
    }),
    // Dedicated error log for structured error tracking
    new transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
      format: format.combine(
        format.uncolorize(),
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.errors({ stack: true }),
        format.json()
      ),
    }),
  ],
});

/**
 * Create a child logger scoped to a module.
 * Usage: const log = logger.child({ module: "Judge" });
 * Then log.error("msg", { severity: "critical", prNumber: 42 });
 */
module.exports = logger;
