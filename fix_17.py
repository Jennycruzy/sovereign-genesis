# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v2

    - name: Set up Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '14'

    - name: Install dependencies
      run: npm install

    - name: Run unit tests
      run: npm test

    - name: Report test results
      uses: actions/upload-artifact@v2
      with:
        name: test-results
        path: test-results.xml
        if: always()