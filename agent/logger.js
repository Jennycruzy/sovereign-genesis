const winston = require('winston');
const path = require('path');

// Custom format for structured logging
const customFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.prettyPrint()
);

// Create the logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: customFormat,
    defaultMeta: { 
        service: 'sovereign-agent',
        version: process.env.npm_package_version || '1.0.0'
    },
    transports: [
        // Error logs to separate file
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            )
        }),
        
        // All logs to combined file
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 10,
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            )
        }),
        
        // Console output with colors for development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({
                    format: 'HH:mm:ss'
                }),
                winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
                    let metaStr = '';
                    if (Object.keys(meta).length > 0) {
                        metaStr = ` ${JSON.stringify(meta, null, 2)}`;
                    }
                    return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
                })
            )
        })
    ],
    
    // Handle exceptions and rejections
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/exceptions.log'),
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            )
        })
    ],
    
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/rejections.log'),
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            )
        })
    ]
});

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Add helper methods for common logging patterns
logger.logError = function(message, error, context = {}) {
    this.error(message, {
        error: {
            message: error.message,
            stack: error.stack,
            name: error.name,
            code: error.code
        },
        ...context,
        timestamp: new Date().toISOString()
    });
};

logger.logTransaction = function(action, txHash, context = {}) {
    this.info(`Transaction ${action}`, {
        transaction: {
            hash: txHash,
            action
        },
        ...context,
        timestamp: new Date().toISOString()
    });
};

logger.logBounty = function(action, bountyId, amount, context = {}) {
    this.info(`Bounty ${action}`, {
        bounty: {
            id: bountyId,
            amount,
            action
        },
        ...context,
        timestamp: new Date().toISOString()
    });
};

logger.logPRReview = function(prNumber, verdict, context = {}) {
    this.info(`PR Review: ${verdict}`, {
        pr: {
            number: prNumber,
            verdict
        },
        ...context,
        timestamp: new Date().toISOString()
    });
};

module.exports = logger;