import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connectDb } from "./db.js";
import { PORT } from "./config.js";
import { getSettings } from "./helpers/settings.js";
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";
import orderRoutes from "./routes/orders.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "https://api.lioneyo.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(publicRoutes);
app.use(adminRoutes);
app.use(orderRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ detail: err.message || "Server error" });
});

async function start() {
  await connectDb();
  await getSettings();

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Node backend listening on http://localhost:${PORT}`);
  });

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the existing process or run with a different PORT.`,
      );
      process.exit(1);
    }
    throw error;
  });
}

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
