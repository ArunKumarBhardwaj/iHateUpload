import type { NextConfig } from "next";

// Engine files under a version-pinned path (src/lib/wasm-assets.ts) never change at that URL.
const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];

const nextConfig: NextConfig = {
  transpilePackages: ["heic2any"],
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return ["/tesseract/:path*", "/tessdata/:path*", "/pdfjs/:path*"].map((source) => ({
      source,
      headers: immutable,
    }));
  },
};

export default nextConfig;
