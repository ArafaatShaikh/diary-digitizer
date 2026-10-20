import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Paper, kept close",
    short_name: "My pages",
    description: "Your handwritten pages, searchable and kept together.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#923f2b",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
