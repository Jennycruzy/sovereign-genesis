// agent/scanner.js

const { BOUNTY_LABELS } = process.env;

// Parse bounty labels from environment variable
const bountyLabels = BOUNTY_LABELS ? JSON.parse(BOUNTY_LABELS) : {};

// Function to determine reward based on bounty label
function getRewardForLabel(label) {
  return bountyLabels[label] || 0;
}

// Existing code...
async function scanContracts() {
  // Existing code...

  // Check for bounty labels and assign rewards
  const bountyLabel = contract.labels.find(label => bountyLabels[label]);
  if (bountyLabel) {
    contract.reward = getRewardForLabel(bountyLabel);
  }

  // Existing code...
}

// Existing code...