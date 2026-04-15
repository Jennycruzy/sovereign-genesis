const { expect } = require("chai");                                  
  const { ContractCache } = require("../agent/contract-cache");
                                                                       
  describe("ContractCache", function () {
    let cache;                                                         
                  
    beforeEach(function () {
      cache = new ContractCache(100);
    });

    it("returns undefined for missing keys", function () {             
      expect(cache.get("missing")).to.be.undefined;
    });                                                                
                  
    it("stores and retrieves a value", function () {                   
      cache.set("balance", "9.5");
      expect(cache.get("balance")).to.equal("9.5");                    
    });                                                                
   
    it("overwrites existing values", function () {                     
      cache.set("key", "old");
      cache.set("key", "new");
      expect(cache.get("key")).to.equal("new");
    });                                                                
   
    it("clear() removes all entries", function () {                    
      cache.set("a", 1);
      cache.set("b", 2);                                               
      cache.clear();
      expect(cache.get("a")).to.be.undefined;                          
      expect(cache.get("b")).to.be.undefined;
    });                                                                
  });
