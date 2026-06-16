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
    config.resolve.conditionNames = ['@silkweave/source', ...(config.resolve.conditionNames ?? ['import', 'require', 'default'])]
    return config
  }
}

export default nextConfig
