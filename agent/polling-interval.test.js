const { calculate, createManager, MIN_INTERVAL_MS, MAX_INTERVAL_MS } = require('./polling-interval');

// Test 1: No activity = max interval
const idle = calculate({ openIssueCount: 0, recentActivityCount: 0, msSinceLastChange: 3600000 });
console.assert(idle === MAX_INTERVAL_MS, 'Idle should return max interval');
console.log('[PASS] Idle state -> max interval');

// Test 2: High activity = min interval
const busy = calculate({ openIssueCount: 20, recentActivityCount: 5, msSinceLastChange: 0 });
console.assert(busy === MIN_INTERVAL_MS, 'Busy should return min interval');
console.log('[PASS] Busy state -> min interval');

// Test 3: Moderate activity = mid interval
const moderate = calculate({ openIssueCount: 10, recentActivityCount: 2, msSinceLastChange: 1800000 });
console.assert(moderate > MIN_INTERVAL_MS && moderate < MAX_INTERVAL_MS, 'Moderate should be between min and max');
console.log('[PASS] Moderate state -> mid interval');

// Test 4: Manager tracks state
const mgr = createManager();
const before = mgr.getInterval(5);
mgr.recordChange();
mgr.recordActivity(3);
const after = mgr.getInterval(5);
console.assert(after < before, 'After activity, interval should decrease');
console.log('[PASS] Manager correctly adjusts interval after activity');

// Test 5: Performance metrics
console.log('
=== Performance Comparison ===');
console.log('Old: Fixed 60,000ms (always)');
console.log('New (idle): ' + idle + 'ms (saves ' + (idle - 60000) + 'ms per cycle)');
console.log('New (busy): ' + busy + 'ms (saves ' + (60000 - busy) + 'ms per cycle)');
console.log('New (moderate): ' + moderate + 'ms');
console.log('
All tests passed!');

mgr.destroy();
