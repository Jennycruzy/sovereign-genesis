# Add Unit Tests for SovereignAgent

> Last updated: 2026-04-08

## Overview

This feature adds unit tests for the `SovereignAgent` smart contract to validate its core functionalities. The tests cover critical functions and edge cases to enhance reliability and correctness.

## How It Works

The tests are implemented in `src/__tests__/SovereignAgent.test.js` and `test/SovereignAgent.test.js`. They utilize the testing framework to simulate various scenarios for the `postBounty`, `releaseBounty`, and `investSurplus` functions, ensuring that all edge cases are handled appropriately.

## Configuration

No configuration required.

## Usage

Run the test suite with `npm test` to execute the unit tests.

## References

- Closes issue #3
