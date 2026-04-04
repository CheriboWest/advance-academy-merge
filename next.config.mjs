/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@advance-academy/contracts'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
