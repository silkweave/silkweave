import type { NextConfig } from 'next'

// Resolve workspace `@silkweave/*` imports to TS source in dev via our custom
// export condition (kept off the published default so external installs get
// build/). `transpilePackages` lets Next compile that raw TS from node_modules.
const SILKWEAVE_PACKAGES = [
  '@silkweave/auth',
  '@silkweave/core',
  '@silkweave/logger',
  '@silkweave/mcp',
  '@silkweave/nextjs',
  '@silkweave/trpc',
  '@silkweave/vercel'
]

const nextConfig: NextConfig = {
  transpilePackages: SILKWEAVE_PACKAGES,
  webpack: (config) => {
    // Prepend our source condition to webpack's defaults (`'...'`), so we keep
    // `node`/`browser`/etc. that deps like pkce-challenge need in their exports.
    config.resolve.conditionNames = ['@silkweave/source', '...']
    // Map NodeNext `.js` import specifiers to their `.ts` source (our own files
    // and the transpiled `@silkweave/*` source), which webpack can't otherwise resolve.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs']
    }
    return config
  }
}

export default nextConfig
