/**
 * scheduler.js — Dynamic Polling Optimizer
 *
 * Adjusts the polling interval based on repository activity and financial health.
 */
const logger = require("./logger");
const financial = require("./financial");

// Interval limits (configurable via env)
const MIN_INTERVAL = parseInt(process.env.POLLING_MIN_INTERVAL || "15000", 10); // 15s
const MAX_INTERVAL = parseInt(process.env.POLLING_MAX_INTERVAL || "300000", 10); // 5m

let currentInterval = parseInt(process.env.SCAN_INTERVAL_MS || "60000", 10);
let timerId = null;

/**
 * Calculates the optimal next polling interval.
 * Reduces interval (faster) if volatility is high or activity is detected.
 * Increases interval (slower) if treasury is low or stagnant.
 */
async function calculateNextInterval() {
    const isVolatile = financial.isHighVolatility();
    
    // Logic: 
    // 1. If volatile, we need higher resolution -> MIN_INTERVAL
    if (isVolatile) {
        logger.info("Scheduler: High volatility detected. Switching to high-frequency polling.");
        return MIN_INTERVAL;
    }

    // 2. Linear Backoff/Decay if things are quiet
    // For now, simple binary switch. 
    // TODO: Integrate GitHub activity metrics (last issue creation time)
    return currentInterval; 
}

function updateTimer(scanFn) {
    if (timerId) clearInterval(timerId);
    
    calculateNextInterval().then(next => {
        currentInterval = next;
        logger.info(`Scheduler: Next scan in ${currentInterval / 1000}s`);
        timerId = setInterval(scanFn, currentInterval);
    });
}

module.exports = { updateTimer, MIN_INTERVAL, MAX_INTERVAL };
