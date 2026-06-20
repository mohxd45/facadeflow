import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Allow webpack to handle `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`
      // by treating .mjs worker files as static assets that get emitted to the output.
      config.module.rules.push({
        test: /pdf\.worker(\.min)?\.mjs$/,
        type: "asset/resource",
        generator: {
          filename: "static/chunks/[name].[hash][ext]",
        },
      });
    }
    return config;
  },
};

export default nextConfig;
