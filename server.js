import express from "express";
import helmet from "helmet";
import cors from "cors";

import { env } from "./src/config/env.js";
import chatRoutes from "./src/routes/chat.routes.js";
import importRoutes from "./src/routes/import.routes.js";
import adminRoutes from "./src/routes/admin.routes.js";

const app = express();

// Security headers. Relaxed CSP so the embeddable widget can be served/used.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// CORS: the widget script is same-origin, but /api/* is called cross-origin
// from the client site. Allow only the configured origins (no blanket "*").
const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser requests (curl, server-to-server) which send no origin.
    // For a disallowed browser origin, omit CORS headers (no error) so the
    // browser blocks it client-side without polluting the server with 500s.
    callback(null, !origin || env.allowedOrigins.includes(origin));
  },
};
app.use("/api", cors(corsOptions));
app.options("/api/*", cors(corsOptions));

app.use(express.json());

// Static assets (widget, test host page) — populated in Phase 6.
app.use(express.static("public"));

// Health check.
app.get("/", (req, res) => {
  res.json({ status: "ok", name: "THE GUARDIAN" });
});

// API routers (mostly empty stubs until their phase is built).
app.use("/api", chatRoutes);
app.use("/api", importRoutes);
app.use("/admin", adminRoutes);

// 404 fallback.
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralised error handler — clean JSON, never leak stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(env.port, () => {
  console.log(`THE GUARDIAN listening on http://localhost:${env.port}`);
});
