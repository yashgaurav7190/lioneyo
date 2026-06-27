import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config.js";

export function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ detail: "Missing token" });
  }

  const token = auth.slice(7);
  try {
    const data = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (data.role !== "admin") {
      return res.status(403).json({ detail: "Not admin" });
    }
    req.admin = data;
    next();
  } catch (error) {
    return res.status(401).json({ detail: "Invalid token" });
  }
}
