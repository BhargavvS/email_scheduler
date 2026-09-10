/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NOTE: do NOT set `output: 'standalone'` here — that mode is only for the
  // Docker image (`frontend/Dockerfile`, currently unused) and makes Vercel
  // serve 404 on every route. Vercel needs the default output.
};

export default nextConfig;
