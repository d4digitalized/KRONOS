import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // OAuth discovery — well-known cesty na naše metadata route handlery.
    // Kryjeme i variantu s příponou cesty (RFC 8414/9728), kterou klient
    // někdy dotazuje podle path issueru/resource.
    return [
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/metadata/authorization-server",
      },
      {
        source: "/.well-known/oauth-authorization-server/:path*",
        destination: "/api/oauth/metadata/authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth/metadata/protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/oauth/metadata/protected-resource",
      },
    ];
  },
};

export default nextConfig;
