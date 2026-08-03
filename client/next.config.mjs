import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:3001",
  },
  webpack: (config) => {
    // `src/vendor/shared` is TypeScript written for Node's ESM resolver, so its
    // relative re-exports carry `.js` extensions that only exist after a build
    // (`export * from './contracts/findings.js'`). tsc maps those back to `.ts`
    // and so does Node; webpack does not, and fails with "Can't resolve
    // './contracts/findings.js'".
    //
    // It stayed hidden because every other client import from the barrel is
    // `import type`, which is erased before webpack ever resolves it — the
    // first RUNTIME import (a Zod schema) is what surfaces it.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
