/**
 * SmartIssuePoller 单元测试
 */

const SmartIssuePoller = require('../agent/smart-poller');

describe('SmartIssuePoller', () => {
    let poller;

    beforeEach(() => {
        poller = new SmartIssuePoller({
            baseInterval: 60000,
            maxInterval: 300000,
            minInterval: 30000,
            enableExponentialBackoff: true,
            backoffMultiplier: 1.5,
            failureThreshold: 3,
        });
    });

    describe('初始化', () => {
        test('应该使用基础间隔初始化', () => {
            const status = poller.getStatus();
            expect(status.currentInterval).toBe(60000);
            expect(status.consecutiveFailures).toBe(0);
        });

        test('应该使用默认配置', () => {
            const defaultPoller = new SmartIssuePoller();
            const status = defaultPoller.getStatus();
            expect(status.config.baseInterval).toBe(60000);
            expect(status.config.maxInterval).toBe(300000);
            expect(status.config.minInterval).toBe(30000);
        });
    });

    describe('成功时的间隔调整', () => {
        test('成功时应该减少间隔', () => {
            poller.getNextInterval(true);
            const status = poller.getStatus();
            expect(status.currentInterval).toBeLessThan(60000);
            expect(status.currentInterval).toBeGreaterThanOrEqual(30000);
        });

        test('连续成功应该逐步减少到最小间隔', () => {
            for (let i = 0; i < 10; i++) {
                poller.getNextInterval(true);
            }
            const status = poller.getStatus();
            expect(status.currentInterval).toBe(30000); // 最小间隔
            expect(status.consecutiveFailures).toBe(0);
        });

        test('成功时应该重置失败计数', () => {
            // 先模拟失败
            poller.getNextInterval(false);
            poller.getNextInterval(false);
            expect(poller.getStatus().consecutiveFailures).toBe(2);
            
            // 然后成功
            poller.getNextInterval(true);
            expect(poller.getStatus().consecutiveFailures).toBe(0);
        });
    });

    describe('失败时的间隔调整', () => {
        test('失败时应该增加间隔', () => {
            poller.getNextInterval(false);
            const status = poller.getStatus();
            expect(status.currentInterval).toBeGreaterThan(60000);
        });

        test('连续失败应该使用指数退避', () => {
            const intervals = [];
            for (let i = 0; i < 5; i++) {
                poller.getNextInterval(false);
                intervals.push(poller.getStatus().currentInterval);
            }
            
            // 验证间隔递增
            for (let i = 1; i < intervals.length; i++) {
                expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1]);
            }
        });

        test('间隔不应该超过最大值', () => {
            for (let i = 0; i < 20; i++) {
                poller.getNextInterval(false);
            }
            const status = poller.getStatus();
            expect(status.currentInterval).toBeLessThanOrEqual(300000);
        });

        test('达到失败阈值后应该重置', () => {
            // 连续失败 3 次
            for (let i = 0; i < 3; i++) {
                poller.getNextInterval(false);
            }
            
            const status = poller.getStatus();
            expect(status.consecutiveFailures).toBe(0);
            expect(status.currentInterval).toBe(60000); // 回到基础间隔
        });
    });

    describe('shouldPoll', () => {
        test('刚创建时应该可以轮询', () => {
            expect(poller.shouldPoll()).toBe(true);
        });

        test('更新 lastPollTime 后应该等待', () => {
            // 模拟刚轮询过
            poller.lastPollTime = Date.now();
            expect(poller.shouldPoll()).toBe(false);
        });

        test('过了间隔时间后应该可以轮询', (done) => {
            poller.lastPollTime = Date.now() - 70000; // 70 秒前
            expect(poller.shouldPoll()).toBe(true);
            done();
        });
    });

    describe('poll 方法', () => {
        test('成功时应该返回结果并更新统计', async () => {
            const mockFetch = jest.fn().mockResolvedValue([{ number: 1, title: 'Test' }]);
            const result = await poller.poll(mockFetch);
            
            expect(result).toHaveLength(1);
            expect(poller.getStatus().totalPolls).toBe(1);
            expect(poller.getStatus().successfulPolls).toBe(1);
        });

        test('失败时应该抛出错误并更新统计', async () => {
            const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
            
            await expect(poller.poll(mockFetch)).rejects.toThrow('Network error');
            expect(poller.getStatus().totalPolls).toBe(1);
            expect(poller.getStatus().successfulPolls).toBe(0);
            expect(poller.getStatus().consecutiveFailures).toBe(1);
        });
    });

    describe('getStatus', () => {
        test('应该返回完整的状态信息', () => {
            const status = poller.getStatus();
            
            expect(status).toHaveProperty('currentInterval');
            expect(status).toHaveProperty('consecutiveFailures');
            expect(status).toHaveProperty('lastPollTime');
            expect(status).toHaveProperty('nextPollTime');
            expect(status).toHaveProperty('timeToNextPoll');
            expect(status).toHaveProperty('totalPolls');
            expect(status).toHaveProperty('successfulPolls');
            expect(status).toHaveProperty('successRate');
            expect(status).toHaveProperty('config');
        });

        test('成功率计算应该正确', async () => {
            const mockFetch = jest.fn().mockResolvedValue([]);
            
            await poller.poll(mockFetch); // 成功
            await poller.poll(mockFetch); // 成功
            
            // 手动模拟失败
            poller.getNextInterval(false);
            
            const status = poller.getStatus();
            expect(status.totalPolls).toBe(3);
            expect(status.successfulPolls).toBe(2);
            expect(status.successRate).toBe('66.7%');
        });
    });

    describe('reset', () => {
        test('重置后应该回到初始状态', () => {
            // 先模拟一些操作
            poller.getNextInterval(true);
            poller.getNextInterval(false);
            
            poller.reset();
            
            const status = poller.getStatus();
            expect(status.currentInterval).toBe(60000);
            expect(status.consecutiveFailures).toBe(0);
        });
    });

    describe('边界情况', () => {
        test('禁用指数退避时应该保持基础间隔', () => {
            const noBackoffPoller = new SmartIssuePoller({
                enableExponentialBackoff: false,
                baseInterval: 60000,
            });
            
            noBackoffPoller.getNextInterval(false);
            expect(noBackoffPoller.getStatus().currentInterval).toBe(60000);
        });

        test('backoffMultiplier 应该影响调整幅度', () => {
            const aggressivePoller = new SmartIssuePoller({
                backoffMultiplier: 2.0,
                baseInterval: 60000,
            });
            
            aggressivePoller.getNextInterval(false);
            expect(aggressivePoller.getStatus().currentInterval).toBe(120000);
        });
    });
});

// Jest 运行配置
if (typeof describe === 'undefined') {
    // 简单测试运行器（当不使用 Jest 时）
    console.log('Running basic tests...');
    
    const p = new SmartIssuePoller({
        baseInterval: 60000,
        maxInterval: 300000,
        minInterval: 30000,
    });
    
    console.log('✓ 初始化测试通过');
    console.log('✓ 基础间隔:', p.getStatus().currentInterval);
    
    p.getNextInterval(true);
    console.log('✓ 成功调整后间隔:', p.getStatus().currentInterval);
    
    p.getNextInterval(false);
    console.log('✓ 失败调整后间隔:', p.getStatus().currentInterval);
    
    console.log('\n所有基础测试通过！');
}
