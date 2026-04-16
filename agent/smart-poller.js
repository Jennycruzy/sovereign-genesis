/**
 * SmartIssuePoller - 智能轮询策略
 * 
 * 根据轮询成功率动态调整轮询间隔：
 * - 成功时：减少间隔，更快响应
 * - 失败时：指数退避，避免 API 限制
 * - 阈值保护：连续失败后重置
 */

const logger = require("./logger");

class SmartIssuePoller {
    constructor(config = {}) {
        this.config = {
            baseInterval: config.baseInterval || 60000,        // 基础间隔 60 秒
            maxInterval: config.maxInterval || 300000,         // 最大间隔 5 分钟
            minInterval: config.minInterval || 30000,          // 最小间隔 30 秒
            enableExponentialBackoff: config.enableExponentialBackoff !== false,
            backoffMultiplier: config.backoffMultiplier || 1.5,
            failureThreshold: config.failureThreshold || 3,
        };
        
        this.currentInterval = this.config.baseInterval;
        this.consecutiveFailures = 0;
        this.lastPollTime = 0;
        this.totalPolls = 0;
        this.successfulPolls = 0;
        
        logger.info(`SmartPoller: initialized with base=${this.config.baseInterval}ms, ` +
            `max=${this.config.maxInterval}ms, min=${this.config.minInterval}ms`);
    }

    /**
     * 获取下次轮询间隔
     * @param {boolean} success - 上次轮询是否成功
     * @returns {number} 下次轮询间隔（毫秒）
     */
    getNextInterval(success) {
        if (success) {
            // 成功时减少间隔，更快响应新 issues
            this.consecutiveFailures = 0;
            this.successfulPolls++;
            
            // 逐步减少到最小间隔
            const newInterval = Math.max(
                this.config.minInterval,
                Math.floor(this.currentInterval / this.config.backoffMultiplier)
            );
            
            if (newInterval < this.currentInterval) {
                logger.debug(`SmartPoller: success - interval reduced ${this.currentInterval}ms → ${newInterval}ms`);
            }
            
            this.currentInterval = newInterval;
        } else {
            // 失败时增加间隔，使用指数退避
            this.consecutiveFailures++;
            
            if (this.config.enableExponentialBackoff) {
                const newInterval = Math.min(
                    this.config.maxInterval,
                    Math.floor(this.currentInterval * this.config.backoffMultiplier)
                );
                
                if (newInterval > this.currentInterval) {
                    logger.warn(`SmartPoller: failure - interval increased ${this.currentInterval}ms → ${newInterval}ms ` +
                        `(failures: ${this.consecutiveFailures})`);
                }
                
                this.currentInterval = newInterval;
            }
            
            // 超过阈值时重置
            if (this.consecutiveFailures >= this.config.failureThreshold) {
                logger.warn(`SmartPoller: failure threshold reached (${this.config.failureThreshold}), resetting`);
                this.currentInterval = this.config.baseInterval;
                this.consecutiveFailures = 0;
            }
        }
        
        return this.currentInterval;
    }

    /**
     * 检查是否应该执行轮询
     * @returns {boolean} 是否应该轮询
     */
    shouldPoll() {
        const now = Date.now();
        return now - this.lastPollTime >= this.currentInterval;
    }

    /**
     * 执行轮询
     * @param {Function} fetchIssues - 获取 issues 的异步函数
     * @returns {Promise<Array>} issues 列表
     */
    async poll(fetchIssues) {
        this.totalPolls++;
        this.lastPollTime = Date.now();
        
        try {
            const issues = await fetchIssues();
            this.getNextInterval(true);
            return issues;
        } catch (error) {
            this.getNextInterval(false);
            logger.error(`SmartPoller: poll failed - ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取当前轮询状态
     * @returns {Object} 轮询状态
     */
    getStatus() {
        const now = Date.now();
        return {
            currentInterval: this.currentInterval,
            consecutiveFailures: this.consecutiveFailures,
            lastPollTime: this.lastPollTime,
            nextPollTime: this.lastPollTime + this.currentInterval,
            timeToNextPoll: Math.max(0, this.lastPollTime + this.currentInterval - now),
            totalPolls: this.totalPolls,
            successfulPolls: this.successfulPolls,
            successRate: this.totalPolls > 0 
                ? ((this.successfulPolls / this.totalPolls) * 100).toFixed(1) + '%' 
                : 'N/A',
            config: this.config,
        };
    }

    /**
     * 重置轮询器
     */
    reset() {
        this.currentInterval = this.config.baseInterval;
        this.consecutiveFailures = 0;
        this.lastPollTime = 0;
        logger.info('SmartPoller: reset to base interval');
    }
}

module.exports = SmartIssuePoller;
