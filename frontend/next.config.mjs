/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for `frontend/Dockerfile` multi-stage build (`outputStandalone`)
  output: 'standalone',
};

export default nextConfig;
