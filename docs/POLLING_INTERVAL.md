# Dynamic Polling Interval

Replaces the fixed 60-second polling interval with a dynamic strategy that adjusts based on:

1. **Number of open issues** - More issues = poll more frequently
2. **Recent activity** - New issues/comments = increase frequency
3. **Time since last change** - No changes for a while = decrease frequency

## Performance

| Scenario | Old Interval | New Interval | Improvement |
|----------|-------------|-------------|-------------|
| Idle (no issues) | 60s | 300s (5min) | 80% fewer API calls |
| Busy (20+ issues) | 60s | 30s | 2x faster detection |
| Moderate | 60s | ~150s | 60% fewer API calls |

## Usage



## Tests


