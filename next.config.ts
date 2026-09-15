import type { NextConfig } from "next";
import { getBaseUrl } from "./src/lib/api/client";
import {
  objectStoreUrlsFrom,
  requireObjectStoreOrigins,
  securityHeaders,
} from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    const development = process.env.NODE_ENV !== "production";
    const objectStoreUrls = objectStoreUrlsFrom(process.env.CSP_OBJECT_STORE_ORIGINS);

    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          apiUrl: getBaseUrl(),
          objectStoreUrls: development ? objectStoreUrls : requireObjectStoreOrigins(objectStoreUrls),
          development,
        }),
      },
    ];
  },
};

export default nextConfig;
