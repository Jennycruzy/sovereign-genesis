/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  output: process.env.NETLIFY ? undefined : "standalone",
  env: {
    NEXT_PUBLIC_ETHERLINK_RPC:       process.env.NEXT_PUBLIC_ETHERLINK_RPC || "https://node.shadownet.etherlink.com",
    NEXT_PUBLIC_CONTRACT_ADDRESS:    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "",
    NEXT_PUBLIC_POLL_INTERVAL_MS:    process.env.NEXT_PUBLIC_POLL_INTERVAL_MS || "5000",
  },
};
