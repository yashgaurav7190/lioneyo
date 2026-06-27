import express from "express";
import crypto from "crypto";
import axios from "axios";
import { getDb } from "../db.js";
import { getSettings, makeOrderNumber } from "../helpers/settings.js";
import { genId, nowIso, getRazorpayClient, notifyWhatsapp } from "../utils.js";
import {
  GOOGLE_SHEETS_WEBHOOK,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
} from "../config.js";

const router = express.Router();

router.post("/api/orders/create", async (req, res) => {
  const body = req.body || {};
  const settings = await getSettings();
  const orderNumber = makeOrderNumber();
  const paymentMethod = body.payment_method;
  const payableNow =
    paymentMethod === "partial_cod"
      ? Number(settings.cod_advance || 150)
      : Number(body.total || 0);
  const amountDue =
    paymentMethod === "partial_cod" ? Number(body.total || 0) - payableNow : 0;

  const order = {
    id: genId(),
    order_number: orderNumber,
    items: body.items || [],
    subtotal: Number(body.subtotal || 0),
    discount: Number(body.discount || 0),
    shipping: Number(body.shipping || 0),
    cod_fee: Number(body.cod_fee || 0),
    total: Number(body.total || 0),
    amount_paid: 0,
    amount_due: amountDue,
    payment_method: paymentMethod,
    payment_status: "pending",
    razorpay_order_id: null,
    razorpay_payment_id: null,
    coupon_code: body.coupon_code || null,
    referral_code: body.referral_code || null,
    referral_discount: Number(body.referral_discount || 0),
    shipping_address: body.shipping_address || {},
    user_email: body.user_email || body.shipping_address?.email || "",
    status: "placed",
    tracking_number: null,
    notes: "",
    wa_notified: [],
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  try {
    const client = getRazorpayClient(settings);
    const rzpOrder = await client.orders.create({
      amount: Math.round(payableNow * 100),
      currency: "INR",
      receipt: orderNumber.slice(0, 40),
      payment_capture: 1,
      notes: { order_number: orderNumber },
    });

    order.razorpay_order_id = rzpOrder.id;
    await getDb().collection("orders").insertOne(order);

    return res.json({
      order,
      razorpay: {
        key_id: settings.razorpay_key_id || RAZORPAY_KEY_ID,
        order_id: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
      },
      payable_now: payableNow,
      amount_due: amountDue,
    });
  } catch (error) {
    console.error("Razorpay error:", error);
    return res.status(500).json({ detail: "Payment provider error" });
  }
});

router.post("/api/orders/verify", async (req, res) => {
  const payload = req.body || {};
  const orderId = payload.razorpay_order_id;
  const payId = payload.razorpay_payment_id;
  const sig = payload.razorpay_signature;
  const settings = await getSettings();
  const secret = settings.razorpay_key_secret || RAZORPAY_KEY_SECRET;

  if (!orderId || !payId || !sig || !secret) {
    return res.status(400).json({ detail: "Missing fields" });
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${payId}`)
    .digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig))) {
    return res.status(400).json({ detail: "Invalid signature" });
  }

  const db = getDb();
  const order = await db
    .collection("orders")
    .findOne({ razorpay_order_id: orderId });
  if (!order) return res.status(404).json({ detail: "Order not found" });

  const paid =
    order.payment_method === "partial_cod"
      ? Number(settings.cod_advance || 150)
      : order.total;
  const status = order.payment_method === "partial_cod" ? "partial" : "paid";
  const update = {
    razorpay_payment_id: payId,
    amount_paid: paid,
    amount_due: order.total - paid,
    payment_status: status,
    status: "processing",
    updated_at: nowIso(),
  };

  await db.collection("orders").updateOne({ id: order.id }, { $set: update });

  for (const item of order.items || []) {
    await db
      .collection("products")
      .updateOne(
        { id: item.product_id, "sizes.size": item.size },
        { $inc: { "sizes.$.stock": -item.qty, sold_count: item.qty } },
      );
  }

  if (order.coupon_code) {
    await db
      .collection("coupons")
      .updateOne({ code: order.coupon_code }, { $inc: { used_count: 1 } });
  }

  if (order.referral_code) {
    await db.collection("referral_uses").insertOne({
      id: genId(),
      referral_code: order.referral_code,
      order_id: order.id,
      order_number: order.order_number,
      referee_email: order.user_email,
      discount: order.referral_discount,
      created_at: nowIso(),
    });

    await db
      .collection("users")
      .updateOne(
        { referral_code: order.referral_code },
        {
          $inc: {
            referral_count: 1,
            referral_earnings: order.referral_discount || 0,
          },
        },
      );
  }

  if (GOOGLE_SHEETS_WEBHOOK) {
    try {
      await axios.post(
        GOOGLE_SHEETS_WEBHOOK,
        { ...order, ...update },
        { timeout: 5000 },
      );
    } catch (error) {
      console.warn("Sheets sync failed:", error.message);
    }
  }

  const refreshed = await db.collection("orders").findOne({ id: order.id });
  try {
    await notifyWhatsapp(db, refreshed, "placed");
    if (refreshed.payment_method === "partial_cod") {
      await notifyWhatsapp(db, refreshed, "cod_reminder");
    }
  } catch (error) {
    console.warn("WA notify failed:", error.message);
  }

  res.json({ ok: true, order_number: order.order_number });
});

router.post(
  "/api/razorpay/webhook",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    const body = req.body;
    const signature = req.headers["x-razorpay-signature"] || "";
    const secret = RAZORPAY_WEBHOOK_SECRET;

    if (!secret) {
      return res.status(500).json({ detail: "Webhook secret not configured" });
    }

    const digest = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
      console.warn("Razorpay webhook signature mismatch");
      return res.status(400).json({ detail: "Invalid signature" });
    }

    let payload;
    try {
      payload = JSON.parse(body.toString());
    } catch (error) {
      return res.status(400).json({ detail: "Bad JSON" });
    }

    const event = payload.event;
    const payment = payload.payload?.payment?.entity || {};
    const rzpOrderId = payment.order_id;
    if (!rzpOrderId) return res.json({ ok: true, ignored: true });

    const db = getDb();
    const order = await db
      .collection("orders")
      .findOne({ razorpay_order_id: rzpOrderId });
    if (!order) {
      console.info(`Webhook for unknown order ${rzpOrderId}`);
      return res.json({ ok: true, unknown: true });
    }

    const update = { updated_at: nowIso() };
    if (["payment.captured", "order.paid"].includes(event)) {
      const webhookSettings = await getSettings();
      update.razorpay_payment_id = payment.id;
      update.amount_paid =
        order.payment_method === "partial_cod"
          ? Number(webhookSettings.cod_advance || 150)
          : order.total;
      update.amount_due = order.total - update.amount_paid;
      update.payment_status =
        order.payment_method === "partial_cod" ? "partial" : "paid";
      if (order.status === "placed") update.status = "processing";
    } else if (event === "payment.failed") {
      update.payment_status = "failed";
    }

    await db.collection("orders").updateOne({ id: order.id }, { $set: update });

    if (["paid", "partial"].includes(update.payment_status)) {
      const refreshed = await db.collection("orders").findOne({ id: order.id });
      try {
        await notifyWhatsapp(db, refreshed, "placed");
        if (refreshed.payment_method === "partial_cod") {
          await notifyWhatsapp(db, refreshed, "cod_reminder");
        }
      } catch (error) {
        console.warn("WA notify (webhook) failed:", error.message);
      }
    }

    res.json({ ok: true, event });
  },
);

router.get("/api/orders/track/:order_number", async (req, res) => {
  const orderNumber = String(req.params.order_number).toUpperCase();
  const doc = await getDb()
    .collection("orders")
    .findOne({ order_number: orderNumber }, { projection: { _id: 0 } });
  if (!doc) return res.status(404).json({ detail: "Order not found" });
  res.json(doc);
});

export default router;
