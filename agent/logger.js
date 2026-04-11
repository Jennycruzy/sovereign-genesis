const { createLogger, format, transports } = require("winston");

// Custom format that emits structured key=value lists so errors and
// business-level events are machine-parseable as well as human-readable.
const structuredFormat = format.combine(
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.colorize(),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? Object.entries(meta)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => ` ${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
          .join("")
      : "";
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: structuredFormat,
  transports: [
    new transports.Console(),
    new transports.File({
      filename: "agent.log",
      format:   format.combine(
        format.uncolorize(),
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? Object.entries(meta)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => ` ${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
                .join("")
            : "";
          return `[${timestamp}] ${level}: ${message}${metaStr}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
