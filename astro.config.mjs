import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: process.env.PUBLIC_SITE_ORIGIN || "https://aisergio.dev",
  base: "/MediPoli",
  output: "static",
  trailingSlash: "always",
  integrations: [react()],
  devToolbar: { enabled: false }
});
