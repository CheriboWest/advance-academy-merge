/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@advance-academy/contracts'],
  serverExternalPackages: ['pdf-parse'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
