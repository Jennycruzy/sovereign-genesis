const { createLogger, format, transports } = require("winston");

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.colorize(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : "";
      return `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "agent.log", format: format.uncolorize() }),
  ],
});

module.exports = logger;
