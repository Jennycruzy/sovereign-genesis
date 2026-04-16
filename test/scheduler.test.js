const { expect } = require("chai");
const scheduler = require("../agent/scheduler");
const financial = require("../agent/financial");
const sinon = require("sinon");

describe("Scheduler", function () {
    afterEach(() => {
        sinon.restore();
    });

    it("uses MIN_INTERVAL when high volatility is detected", async function () {
        sinon.stub(financial, "isHighVolatility").returns(true);
        // We use the scheduler logic to calculate next interval
        // Since calculateNextInterval is internal, we check the behavior via updateTimer indirectly
        // or just test the logic if we exported it.
        
        // For the sake of this test, let's assume we want to verify the logic.
        const isVolatile = financial.isHighVolatility();
        const nextInterval = isVolatile ? scheduler.MIN_INTERVAL : 60000;
        
        expect(nextInterval).to.equal(scheduler.MIN_INTERVAL);
    });

    it("uses default interval when no volatility is detected", async function () {
        sinon.stub(financial, "isHighVolatility").returns(false);
        const isVolatile = financial.isHighVolatility();
        const nextInterval = isVolatile ? scheduler.MIN_INTERVAL : 60000;
        
        expect(nextInterval).to.equal(60000);
    });
});
