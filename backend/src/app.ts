// backend/src/app.ts
//
// Trimmed from LifeVerse's original app.ts — the `/api/v1/lifeverse` route
// (community feed, diary, expenses, family, goals, tasks, etc.) is dropped
// entirely since it's LifeVerse's own personal-life-tracking app, not part
// of the education platform. Everything else (auth, users, org, system,
// upload) is the generic framework core, kept as-is.

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes   from "./modules/auth/auth.routes.js";
import usersRoutes  from "./modules/users/users.routes.js";
import systemRoutes from "./modules/system/system.routes.js";
import orgRoutes    from "./modules/org/org.routes.js";
import uploadRoutes from "./modules/upload/upload.routes.js";
import eduRoutes    from "./modules/edu/edu.routes.js";

const app  = express();
const PORT = process.env.PORT ?? 4000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(",") ?? "*",
  credentials: true,
}));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Static uploads ────────────────────────────────────────────────────────────
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ── Request logger (dev) ─────────────────────────────────────────────────────
if (process.env.NODE_ENV === "development") {
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()}  ${req.method}  ${req.path}`);
    next();
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", version: "1.0.0", ts: new Date().toISOString() });
});

app.use("/api/v1/auth",   authRoutes);
app.use("/api/v1/users",  usersRoutes);
app.use("/api/v1/system", systemRoutes);
app.use("/api/v1/orgs",   orgRoutes);
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1",        eduRoutes); // /courses, /levels, /progress — Phase 1 pilot

// TODO (Phase 2+): mount routes for the other 9 modules as they land

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ── Global error handler ─────────────────────────────────────────────────────
// Bumped to 100mb above (see express.json call) — video files needed real
// headroom that 20mb never gave them (a few minutes of compressed video
// routinely exceeds that, even before base64 inflates it further), but
// even 100mb has a ceiling. This was previously falling through to a
// generic "Internal server error" 500, which is exactly the kind of
// unhelpful failure that made "图片上传失败" hard to diagnose — the real
// cause (file too big) was invisible. Now it's a clear, actionable 413
// instead.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const e = err as { type?: string; status?: number };
  if (e?.type === "entity.too.large" || e?.status === 413) {
    res.status(413).json({ success: false, message: "文件太大了，请换一个小一点的文件（图片/PPT上限20MB左右，视频上限100MB）" });
    return;
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  LogiVerse API running on http://localhost:${PORT}`);
  console.log(`   ENV: ${process.env.NODE_ENV ?? "development"}\n`);
  console.log("   Routes:");
  console.log("     GET  /health");
  console.log("     POST /api/v1/auth/login");
  console.log("     POST /api/v1/auth/users        (operator/teacher creates student/parent)");
  console.log("     GET  /api/v1/auth/me");
  console.log("     GET  /api/v1/orgs");
  console.log("     GET  /api/v1/courses");
  console.log("     POST /api/v1/courses/:courseId/levels  (course designer adds a level)");
  console.log("     GET  /api/v1/levels/:levelId    (student fetches a level to play)");
  console.log("     POST /api/v1/levels/:levelId/progress  (student submits a play session)\n");
});

export default app;
