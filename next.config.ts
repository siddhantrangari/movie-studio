import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/videogen', destination: '/admin/videogen' },
      { source: '/studio', destination: '/admin/videogen/studio' },
      { source: '/movie', destination: '/admin/videogen/movie' },
      { source: '/canvas', destination: '/admin/videogen/canvas' },
      { source: '/generations', destination: '/admin/videogen?tab=generations' },
      { source: '/characters', destination: '/admin/videogen?tab=characters' },
    ]
  },
};

export default nextConfig;
