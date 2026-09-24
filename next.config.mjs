/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle for the Docker runtime image (see Dockerfile).
  output: 'standalone',
  // Don't advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  transpilePackages: ['studio', 'ai-agent', 'workflow-builder', 'design-agent'],
};

export default nextConfig;
