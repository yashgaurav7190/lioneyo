import crypto from "crypto";
import { getDb } from "../db.js";
import { defaultSettings } from "../utils.js";

export async function getSettings() {
  const db = getDb();
  let settings = await db.collection("settings").findOne({ id: "global" });
  if (!settings) {
    await db.collection("settings").insertOne(defaultSettings);
    settings = defaultSettings;
  }
  return settings;
}

export function cleanObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const cleaned = { ...obj };
  delete cleaned.id;
  delete cleaned._id;
  return cleaned;
}

export function makeOrderNumber() {
  return `LE${Math.floor(Date.now() / 1000)}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}
