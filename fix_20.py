// agent/contract.js

const { ethers } = require("ethers");

class Contract {
  constructor(provider, contractAddress, abi) {
    this.provider = provider;
    this.contract = new ethers.Contract(contractAddress, abi, provider.getSigner());
  }

  async executeTransaction(method, ...args) {
    const gasPrice = await this.provider.getGasPrice();
    const gasLimit = await this.contract.estimateGas[method](...args);

    const transaction = {
      to: this.contract.address,
      data: this.contract.interface.encodeFunctionData(method, args),
      gasPrice: gasPrice,
      gasLimit: gasLimit,
    };

    const tx = await this.provider.getSigner().sendTransaction(transaction);
    await tx.wait();
    return tx;
  }

  async getBalance(address) {
    return await this.provider.getBalance(address);
  }

  async getTransactionCount(address) {
    return await this.provider.getTransactionCount(address);
  }
}

module.exports = Contract;