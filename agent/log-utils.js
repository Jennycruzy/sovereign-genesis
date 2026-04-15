const logger = require("./logger");                                  
                                     
  function logAIReviewError(prNumber, error, raw) {                    
    logger.error(                                  
      `Judge [PR #${prNumber}]: AI review failed — ` +
      `model=${process.env.OPENAI_MODEL || "gpt-4o"} ` +
      `error=${error?.message || "unknown"} ` +                        
      `raw=${raw ? raw.slice(0, 200) : "none"}`
    );                                                                
  }                                                                    
   
  module.exports = { logAIReviewError };  
