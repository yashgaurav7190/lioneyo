import express from "express";
import crypto from "crypto";
import { getDb } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { cleanObject, getSettings } from "../helpers/settings.js";
import {
  hashPassword,
  verifyPassword,
  makeToken,
  genId,
  nowIso,
} from "../utils.js";

const router = express.Router();

router.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ detail: "Email and password required" });
  }

  const user = await getDb()
    .collection("admins")
    .findOne({ email: email.toLowerCase() });

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ detail: "Invalid credentials" });
  }

  const token = makeToken({ role: "admin", email: user.email });
  return res.json({ token, email: user.email });
});

router.post("/api/admin/change-password", requireAdmin, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password || new_password.length < 8) {
    return res
      .status(400)
      .json({ detail: "new_password must be at least 8 characters" });
  }

  const user = await getDb()
    .collection("admins")
    .findOne({ email: req.admin.email });
  if (!user || !(await verifyPassword(current_password, user.password_hash))) {
    return res.status(401).json({ detail: "Current password incorrect" });
  }

  await getDb()
    .collection("admins")
    .updateOne(
      { email: req.admin.email },
      {
        $set: {
          password_hash: await hashPassword(new_password),
          updated_at: nowIso(),
        },
      },
    );

  return res.json({ ok: true });
});

router.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ email: req.admin.email, role: req.admin.role });
});

router.get("/api/admin/settings", requireAdmin, async (req, res) => {
  const settings = await getSettings();
  const cleaned = { ...settings };
  delete cleaned._id;
  res.json(cleaned);
});

router.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const payload = cleanObject(req.body || {});
  await getDb()
    .collection("settings")
    .updateOne({ id: "global" }, { $set: payload }, { upsert: true });
  const settings = await getSettings();
  res.json(settings);
});

router.post("/api/admin/collections", requireAdmin, async (req, res) => {
  const body = req.body || {};
  if (await getDb().collection("collections").findOne({ slug: body.slug })) {
    return res.status(400).json({ detail: "Slug exists" });
  }

  const collection = { ...body, id: genId(), created_at: nowIso() };
  await getDb().collection("collections").insertOne(collection);
  res.json(collection);
});

router.put("/api/admin/collections/:cid", requireAdmin, async (req, res) => {
  const body = cleanObject(req.body || {});
  await getDb()
    .collection("collections")
    .updateOne({ id: req.params.cid }, { $set: body });
  const updated = await getDb()
    .collection("collections")
    .findOne({ id: req.params.cid }, { projection: { _id: 0 } });
  res.json(updated);
});

router.delete("/api/admin/collections/:cid", requireAdmin, async (req, res) => {
  await getDb().collection("collections").deleteOne({ id: req.params.cid });
  res.json({ ok: true });
});

router.post("/api/admin/products", requireAdmin, async (req, res) => {
  const body = req.body || {};
  if (await getDb().collection("products").findOne({ slug: body.slug })) {
    return res.status(400).json({ detail: "Slug exists" });
  }

  const product = {
    ...body,
    id: genId(),
    created_at: nowIso(),
    updated_at: nowIso(),
    views: 0,
    sold_count: 0,
  };
  await getDb().collection("products").insertOne(product);
  res.json(product);
});

router.put("/api/admin/products/:pid", requireAdmin, async (req, res) => {
  const body = cleanObject(req.body || {});
  body.updated_at = nowIso();
  await getDb()
    .collection("products")
    .updateOne({ id: req.params.pid }, { $set: body });
  const updated = await getDb()
    .collection("products")
    .findOne({ id: req.params.pid }, { projection: { _id: 0 } });
  res.json(updated);
});

router.delete("/api/admin/products/:pid", requireAdmin, async (req, res) => {
  await getDb().collection("products").deleteOne({ id: req.params.pid });
  res.json({ ok: true });
});

router.post(
  "/api/admin/products/:pid/duplicate",
  requireAdmin,
  async (req, res) => {
    const doc = await getDb()
      .collection("products")
      .findOne({ id: req.params.pid }, { projection: { _id: 0 } });
    if (!doc) return res.status(404).json({ detail: "Not found" });

    const copy = { ...doc };
    copy.id = genId();
    copy.slug = `${copy.slug}-copy-${crypto.randomBytes(3).toString("hex")}`;
    copy.name = `${copy.name} (Copy)`;
    copy.is_hidden = true;
    copy.created_at = nowIso();
    copy.updated_at = nowIso();
    await getDb().collection("products").insertOne(copy);
    res.json(copy);
  },
);

router.get("/api/admin/coupons", requireAdmin, async (req, res) => {
  const coupons = await getDb()
    .collection("coupons")
    .find({}, { projection: { _id: 0 } })
    .toArray();
  res.json(coupons);
});

router.post("/api/admin/coupons", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const code = String(body.code || "").toUpperCase();
  if (await getDb().collection("coupons").findOne({ code })) {
    return res.status(400).json({ detail: "Code exists" });
  }

  const coupon = {
    ...body,
    code,
    id: genId(),
    created_at: nowIso(),
    used_count: body.used_count || 0,
  };
  await getDb().collection("coupons").insertOne(coupon);
  res.json(coupon);
});

router.put("/api/admin/coupons/:cid", requireAdmin, async (req, res) => {
  const body = cleanObject(req.body || {});
  if (body.code) body.code = String(body.code).toUpperCase();
  await getDb()
    .collection("coupons")
    .updateOne({ id: req.params.cid }, { $set: body });
  const updated = await getDb()
    .collection("coupons")
    .findOne({ id: req.params.cid }, { projection: { _id: 0 } });
  res.json(updated);
});

router.delete("/api/admin/coupons/:cid", requireAdmin, async (req, res) => {
  await getDb().collection("coupons").deleteOne({ id: req.params.cid });
  res.json({ ok: true });
});

router.get("/api/admin/reviews", requireAdmin, async (req, res) => {
  const docs = await getDb()
    .collection("reviews")
    .find({}, { projection: { _id: 0 } })
    .sort({ created_at: -1 })
    .toArray();
  res.json(docs);
});

router.put("/api/admin/reviews/:rid", requireAdmin, async (req, res) => {
  const body = cleanObject(req.body || {});
  await getDb()
    .collection("reviews")
    .updateOne({ id: req.params.rid }, { $set: body });
  const updated = await getDb()
    .collection("reviews")
    .findOne({ id: req.params.rid }, { projection: { _id: 0 } });
  res.json(updated);
});

router.delete("/api/admin/reviews/:rid", requireAdmin, async (req, res) => {
  await getDb().collection("reviews").deleteOne({ id: req.params.rid });
  res.json({ ok: true });
});

export default router;
