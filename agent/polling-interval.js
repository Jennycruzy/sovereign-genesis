/**
 * Dynamic Polling Interval Manager
 * 
 * Adjusts GitHub issue polling frequency based on:
 * - Number of open bounty issues
 * - Recent activity (new issues/comments)
 * - Time since last change detected
 * 
 * Usage:
 *   const polling = require('./polling-interval');
 *   const interval = polling.calculate(state);
 */

const MIN_INTERVAL_MS = 30_000;      // 30 seconds minimum
const MAX_INTERVAL_MS = 300_000;     // 5 minutes maximum
const DEFAULT_INTERVAL_MS = 60_000;  // 1 minute default

// Weights for scoring
const WEIGHTS = {
  openIssues: 0.4,      // More open issues = poll more frequently
  recentActivity: 0.3,   // Recent changes = poll more frequently
  timeSinceChange: 0.3,  // No changes for a while = poll less frequently
};

/**
 * Calculate optimal polling interval based on current state.
 * @param {Object} state - Current scanner state
 * @param {number} state.openIssueCount - Number of open bounty issues
 * @param {number} state.recentActivityCount - Issues/comments in last hour
 * @param {number} state.msSinceLastChange - Time since last new issue detected
 * @returns {number} Polling interval in milliseconds
 */
function calculate(state) {
  const { openIssueCount = 0, recentActivityCount = 0, msSinceLastChange = 0 } = state;

  // Score components (0-1 scale, higher = more frequent polling needed)
  const issueScore = Math.min(openIssueCount / 20, 1); // Max at 20 issues
  const activityScore = Math.min(recentActivityCount / 5, 1); // Max at 5 recent events
  const stalenessScore = Math.max(0, 1 - (msSinceLastChange / 3_600_000)); // Decay over 1 hour

  // Weighted composite score (higher = shorter interval)
  const composite = (
    WEIGHTS.openIssues * issueScore +
    WEIGHTS.recentActivity * activityScore +
    WEIGHTS.timeSinceChange * stalenessScore
  );

  // Map score to interval: high score -> low interval
  const interval = MAX_INTERVAL_MS - (composite * (MAX_INTERVAL_MS - MIN_INTERVAL_MS));

  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(interval)));
}

/**
 * Create a polling manager that tracks state and provides intervals.
 * @returns {Object} Polling manager with update() and getInterval() methods
 */
function createManager() {
  let lastChangeTime = Date.now();
  let recentActivityCount = 0;
  let activityDecayTimer = null;

  // Decay activity count every 10 minutes
  function startDecay() {
    activityDecayTimer = setInterval(() => {
      recentActivityCount = Math.max(0, recentActivityCount - 1);
    }, 600_000);
  }

  startDecay();

  return {
    /** Call when a new issue or significant change is detected */
    recordChange() {
      lastChangeTime = Date.now();
      recentActivityCount = Math.min(recentActivityCount + 1, 10);
    },

    /** Call when scanning finds new activity */
    recordActivity(count = 1) {
      recentActivityCount = Math.min(recentActivityCount + count, 10);
    },

    /** Get the current optimal polling interval */
    getInterval(openIssueCount = 0) {
      return calculate({
        openIssueCount,
        recentActivityCount,
        msSinceLastChange: Date.now() - lastChangeTime,
      });
    },

    /** Stop the decay timer */
    destroy() {
      if (activityDecayTimer) clearInterval(activityDecayTimer);
    },

    /** Get current state for debugging */
    getState(openIssueCount = 0) {
      return {
        openIssueCount,
        recentActivityCount,
        msSinceLastChange: Date.now() - lastChangeTime,
        currentInterval: this.getInterval(openIssueCount),
      };
    },
  };
}

module.exports = { calculate, createManager, MIN_INTERVAL_MS, MAX_INTERVAL_MS, DEFAULT_INTERVAL_MS };
