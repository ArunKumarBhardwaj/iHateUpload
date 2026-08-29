import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["heic2any"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
