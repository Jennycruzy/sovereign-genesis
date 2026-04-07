require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const ETHERLINK_RPC       = process.env.ETHERLINK_RPC       || "https://node.shadownet.etherlink.com";
const ETHERLINK_MAINNET   = process.env.ETHERLINK_MAINNET   || "https://node.mainnet.etherlink.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x" + "0".repeat(64);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },

  networks: {
    // Local development
    hardhat: {},

    // Etherlink Shadownet (testnet — replaced Ghostnet Jan 2026)
    etherlink_testnet: {
      url:      ETHERLINK_RPC,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId:  127823,
    },

    // Etherlink Mainnet
    etherlink_mainnet: {
      url:      ETHERLINK_MAINNET,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId:  42793,
    },
  },

  etherscan: {
    // Etherlink block explorer (if/when supported)
    apiKey: {
      etherlink_testnet: process.env.EXPLORER_API_KEY || "no-key",
      etherlink_mainnet: process.env.EXPLORER_API_KEY || "no-key",
    },
    customChains: [
      {
        network: "etherlink_testnet",
        chainId: 128123,
        urls: {
          apiURL:     "https://testnet.explorer.etherlink.com/api",
          browserURL: "https://testnet.explorer.etherlink.com",
        },
      },
      {
        network: "etherlink_mainnet",
        chainId: 42793,
        urls: {
          apiURL:     "https://explorer.etherlink.com/api",
          browserURL: "https://explorer.etherlink.com",
        },
      },
    ],
  },

  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },
};
