 const DEFAULT_TTL_MS = 5000; // 5 seconds                            
                 
  class ContractCache {                                                
    constructor(ttlMs = DEFAULT_TTL_MS) {
      this.ttlMs = ttlMs;                                              
      this.store = new Map();
    }

    get(key) {
      const entry = this.store.get(key);
      if (!entry) return undefined;                                    
      if (Date.now() - entry.timestamp > this.ttlMs) {
        this.store.delete(key);                                        
        return undefined;
      }
      return entry.value;
    }                                                                  
   
      this.store.set(key, { value, timestamp: Date.now() });          
    }                                                      
     
    clear() {
      this.store.clear();
    }                    
  }  
   
  module.exports = { ContractCache, cache: new ContractCache() }; 
