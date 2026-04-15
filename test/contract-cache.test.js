  const { expect } = require("chai");
  const { ContractCache } = require("../agent/contract-cache");        
                 
  describe("ContractCache", function () {
    let cache;

    beforeEach(function () {                                          
      cache = new ContractCache(100); // 100ms TTL for fast testing
    });                                                                
                 
    it("returns undefined for missing keys", function () {
      expect(cache.get("missing")).to.be.undefined;
    });
                                                                       
    it("stores and retrieves a value", function () {
      cache.set("balance", "9.5");                                    
      expect(cache.get("balance")).to.equal("9.5");
    });

    it("expires entries after TTL", function (done) {                  
      cache.set("key", "value");
      expect(cache.get("key")).to.equal("value");                      
      setTimeout(() => {
        expect(cache.get("key")).to.be.undefined;
        done();                                                        
      }, 150);
                                                                       
    it("clear() removes all entries", function () {
      cache.set("a", 1);                          
      cache.set("b", 2);
      cache.clear();    
      expect(cache.get("a")).to.be.undefined;
      expect(cache.get("b")).to.be.undefined;
    });                                                                
  }); 
