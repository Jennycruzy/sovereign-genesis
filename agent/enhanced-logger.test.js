const assert = require('assert');
const logger = require('./enhanced-logger');

// Test 1: Metrics tracking
logger.reviewStart(123);
logger.reviewEnd({ prNumber: 123, startTime: Date.now() - 100 }, 'PASS', 'looks good');
const m = logger.getMetrics();
assert.strictEqual(m.reviewsTotal, 1, 'Should track 1 review');
assert.strictEqual(m.reviewsPassed, 1, 'Should track 1 pass');
assert.ok(m.avgDurationMs >= 100, 'Should track duration');
console.log('[PASS] Metrics tracking');

// Test 2: Review start returns context
const ctx = logger.reviewStart(456);
assert.strictEqual(ctx.prNumber, 456, 'Should return prNumber');
assert.ok(ctx.startTime > 0, 'Should return startTime');
console.log('[PASS] Review context');

// Test 3: Verdict counting
logger.reviewStart(1);
logger.reviewEnd({ prNumber: 1, startTime: Date.now() }, 'FAIL', 'broken');
logger.reviewStart(2);
logger.reviewEnd({ prNumber: 2, startTime: Date.now() }, 'ERROR', 'crashed');
const m2 = logger.getMetrics();
assert.strictEqual(m2.reviewsFailed, 1, 'Should count fails');
assert.strictEqual(m2.reviewsError, 1, 'Should count errors');
assert.strictEqual(m2.reviewsTotal, 3, 'Total should be 3');
console.log('[PASS] Verdict counting');

// Test 4: API tracking
logger.apiCall('/test');
logger.apiCall('/test2');
logger.apiError('/fail', new Error('test'));
const m3 = logger.getMetrics();
assert.strictEqual(m3.apiCalls, 2, 'Should track API calls');
assert.strictEqual(m3.apiErrors, 1, 'Should track API errors');
console.log('[PASS] API tracking');

// Test 5: Log levels
logger.debug('should not appear at info level');
logger.info('info message');
logger.warn('warning');
logger.error('error msg', { error: new Error('test') });
console.log('[PASS] Log levels');

console.log('\nAll 5 tests passed!');
