import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@video-generator/db",
    "@video-generator/config",
    "@video-generator/queue",
    "@video-generator/types",
    "@video-generator/social-providers",
  ],
};

export default nextConfig;
