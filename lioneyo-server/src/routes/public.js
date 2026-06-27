import express from "express";
import { getDb } from "../db.js";
import { getSettings } from "../helpers/settings.js";
import { genId, nowIso } from "../utils.js";

const router = express.Router();

router.get("/api/settings", async (req, res) => {
  const settings = await getSettings();
  const publicKeys = new Set([
    "logo_light",
    "logo_dark",
    "favicon",
    "announcement_messages",
    "announcement_enabled",
    "hero_heading",
    "hero_subheading",
    "hero_image",
    "hero_video",
    "hero_cta_text",
    "hero_cta_link",
    "shipping_fee",
    "free_shipping_threshold",
    "cod_enabled",
    "cod_advance",
    "cod_fee",
    "whatsapp_number",
    "site_title",
    "site_description",
    "site_keywords",
    "og_image",
    "instagram_url",
    "youtube_url",
    "footer_text",
    "privacy_policy",
    "terms",
    "refund_policy",
    "shipping_policy",
    "trust_badges",
    "low_stock_threshold",
    "razorpay_key_id",
    "google_client_id",
  ]);

  const payload = {};
  for (const key of Object.keys(settings)) {
    if (publicKeys.has(key)) {
      payload[key] = settings[key];
    }
  }
  res.json(payload);
});

router.get("/api/collections", async (req, res) => {
  const collections = await getDb()
    .collection("collections")
    .find({}, { projection: { _id: 0 } })
    .sort({ order: 1 })
    .toArray();
  res.json(collections);
});

router.get("/api/collections/:slug", async (req, res) => {
  const doc = await getDb()
    .collection("collections")
    .findOne({ slug: req.params.slug }, { projection: { _id: 0 } });
  if (!doc) return res.status(404).json({ detail: "Not found" });
  res.json(doc);
});

router.get("/api/products", async (req, res) => {
  const collection = req.query.collection;
  const featured = req.query.featured === "true";
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const query = { is_hidden: { $ne: true } };
  if (collection && collection !== "all") query.collection_slug = collection;
  if (featured) query.is_featured = true;

  const docs = await getDb()
    .collection("products")
    .find(query, { projection: { _id: 0 } })
    .limit(limit)
    .toArray();
  res.json(docs);
});

router.get("/api/products/:slug", async (req, res) => {
  const doc = await getDb()
    .collection("products")
    .findOne({ slug: req.params.slug }, { projection: { _id: 0 } });
  if (!doc) return res.status(404).json({ detail: "Not found" });

  await getDb()
    .collection("products")
    .updateOne({ slug: req.params.slug }, { $inc: { views: 1 } });
  res.json(doc);
});

router.get("/api/products/:slug/related", async (req, res) => {
  const product = await getDb()
    .collection("products")
    .findOne({ slug: req.params.slug }, { projection: { _id: 0 } });
  if (!product) return res.json([]);

  const query = { slug: { $ne: req.params.slug }, is_hidden: { $ne: true } };
  if (product.collection_slug) query.collection_slug = product.collection_slug;

  const docs = await getDb()
    .collection("products")
    .find(query, { projection: { _id: 0 } })
    .limit(8)
    .toArray();
  res.json(docs);
});

router.get("/api/coupons/popup", async (req, res) => {
  const coupon = await getDb()
    .collection("coupons")
    .findOne({ is_popup: true, is_active: true }, { projection: { _id: 0 } });
  res.json(coupon || null);
});

router.post("/api/coupons/validate", async (req, res) => {
  const code = String((req.body?.code || "").toUpperCase());
  const subtotal = parseFloat(req.body?.subtotal || 0);
  const coupon = await getDb()
    .collection("coupons")
    .findOne({ code, is_active: true });

  if (!coupon) return res.status(404).json({ detail: "Invalid coupon" });
  if (subtotal < (coupon.min_order || 0)) {
    return res
      .status(400)
      .json({ detail: `Minimum order ₹${coupon.min_order}` });
  }
  if (
    coupon.usage_limit > 0 &&
    (coupon.used_count || 0) >= coupon.usage_limit
  ) {
    return res.status(400).json({ detail: "Coupon limit reached" });
  }

  let discount =
    coupon.discount_type === "flat"
      ? coupon.discount_value
      : (subtotal * coupon.discount_value) / 100;
  if (coupon.max_discount) discount = Math.min(discount, coupon.max_discount);

  res.json({
    code,
    discount: Math.round(discount * 100) / 100,
    discount_type: coupon.discount_type,
  });
});

router.post("/api/referrals/validate", async (req, res) => {
  const code = String((req.body?.code || "").toUpperCase()).trim();
  const subtotal = parseFloat(req.body?.subtotal || 0);
  const email = String((req.body?.email || "").toLowerCase()).trim();

  if (!code) return res.status(400).json({ detail: "Code required" });

  const settings = await getSettings();
  if (!settings.referral_enabled)
    return res.status(400).json({ detail: "Referrals disabled" });
  if (subtotal < (settings.referral_min_order || 0)) {
    return res
      .status(400)
      .json({ detail: `Minimum order ₹${settings.referral_min_order}` });
  }

  const referrer = await getDb()
    .collection("users")
    .findOne({ referral_code: code });
  if (!referrer)
    return res.status(404).json({ detail: "Invalid referral code" });
  if (email && referrer.email?.toLowerCase() === email) {
    return res
      .status(400)
      .json({ detail: "Cannot use your own referral code" });
  }

  const discountType = settings.referral_discount_type || "percent";
  const discountValue = Number(settings.referral_discount_value || 10);
  let discount =
    discountType === "flat" ? discountValue : (subtotal * discountValue) / 100;
  if (settings.referral_max_discount) {
    discount = Math.min(discount, Number(settings.referral_max_discount));
  }

  res.json({
    code,
    discount: Math.round(discount * 100) / 100,
    discount_type: discountType,
    referrer_email: referrer.email,
  });
});

router.get("/api/reviews/:product_id", async (req, res) => {
  const docs = await getDb()
    .collection("reviews")
    .find(
      { product_id: req.params.product_id, is_approved: true },
      { projection: { _id: 0 } },
    )
    .toArray();
  res.json(docs);
});

router.post("/api/reviews", async (req, res) => {
  const body = req.body || {};
  const review = {
    ...body,
    id: genId(),
    created_at: nowIso(),
    images: body.images || [],
    verified_buyer: false,
    is_approved: false,
  };

  if (
    await getDb().collection("orders").findOne({ user_email: body.user_email })
  ) {
    review.verified_buyer = true;
  }

  await getDb().collection("reviews").insertOne(review);
  res.json(review);
});

export default router;
