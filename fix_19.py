// agent/judge.js

const logger = require('./logger');

async function reviewPR(prData) {
  try {
    // Existing code for reviewing PR
    // ...
  } catch (error) {
    logger.error(`Error reviewing PR: ${prData.prId}`, {
      error: error.message,
      stack: error.stack,
      prData: prData,
    });
    throw error; // Re-throw the error after logging
  }
}

module.exports = {
  reviewPR,
};