import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on IPv4 and IPv6 so both http://127.0.0.1:5173 and http://localhost:5173 work.
    host: true,
    port: 5173,
  },
});
