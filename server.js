const express = require("express");
const cheerio = require("cheerio");
const sources = require("./sources");

// Node fetch
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

process.on("unhandledRejection", (reason) => console.error("Unhandled:", reason));
process.on("uncaughtException", (err) => console.error("Uncaught:", err));

const app = express();
app.use(express.json({ limit: "200kb" }));

// CORS
app.use((req, res, next) => {
  const allowed = ["https://egy-tronix.com", "https://www.egy-tronix.com"];
  const origin = req.headers.origin;
  if (allowed.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Cache
const CACHE = { products: new Map(), contactText: "", lastUpdate: 0 };

function clean(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .trim();
}
function normalize(text) {
  return clean(text).toLowerCase();
}

async function fetchHTML(url) {
  const res = await fetch(url, { headers: { "User-Agent": "KASBot/1.0" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function loadContact() {
  try {
    const html = await fetchHTML(sources.contactUrl);
    const $ = cheerio.load(html);
    CACHE.contactText = clean($("body").text());
  } catch (e) {
    console.error("loadContact:", e.message || e);
  }
}

async function loadProduct(p) {
  try {
    const html = await fetchHTML(p.url);
    const $ = cheerio.load(html);
    const title = clean($("h1").first().text());

    const bullets = [];
    $("li").each((_, el) => {
      const t = clean($(el).text());
      if (t.length > 5 && t.length < 220) bullets.push(t);
    });

    const pdfs = [];
    $("a[href]").each((_, el) => {
      const href = String($(el).attr("href") || "");
      if (href.toLowerCase().includes(".pdf")) pdfs.push(href);
    });

    CACHE.products.set(p.id, {
      id: p.id,
      name: p.name,
      url: p.url,
      title,
      bullets: [...new Set(bullets)].slice(0, 18),
      pdfs: [...new Set(pdfs)].slice(0, 10),
    });
  } catch (e) {
    console.error("loadProduct:", p.url, e.message || e);
  }
}

async function refreshAll() {
  await loadContact();
  for (const p of sources.products) await loadProduct(p);
  CACHE.lastUpdate = Date.now();
  console.log("Refreshed:", new Date(CACHE.lastUpdate).toISOString());
}

refreshAll().catch((e) => console.error("refreshAll:", e));
setInterval(() => refreshAll().catch((e) => console.error("refreshAll:", e)), 6 * 60 * 60 * 1000);

// Product detection
function detectProduct(message) {
  const m = normalize(message);
  for (const p of sources.products) {
    const pn = normalize(p.name);
    if (pn && m.includes(pn)) return p.id;
  }
  if (m.includes("باب") && (m.includes("اوتوماتيك") || m.includes("أوتوماتيك"))) return "automatic_door";
  if (m.includes("فولدينج") || (m.includes("باب") && m.includes("طي"))) return "folding_door";
  return null;
}

function isAddressIntent(msg) {
  const m = normalize(msg);
  return m.includes("عنوان") || m.includes("لوكيشن") || m.includes("فين") || m.includes("مكان");
}
function isManualIntent(msg) {
  const m = normalize(msg);
  return m.includes("دليل") || m.includes("manual") || m.includes("كتالوج") || m.includes("datasheet");
}
function isWiringIntent(msg) {
  const m = normalize(msg);
  return m.includes("مخطط") || m.includes("توصيل") || m.includes("wiring") || m.includes("diagram");
}

app.get("/", (req, res) => res.send("KAS Bot is running"));

app.post("/chat", (req, res, next) => {
  try {
    const message = req.body?.message ? String(req.body.message) : "";
    const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};

    const productId = detectProduct(message) || context.lastProductId || null;
    const nextContext = { lastProductId: productId };

    if (isAddressIntent(message)) {
      return res.json({
        reply:
          "تحديدًا تقصد أي قسم؟\n" +
          "1) عنوان الفرع\n" +
          "2) الدعم الفني\n" +
          "3) خدمة العملاء\n" +
          "اكتب رقم الاختيار أو اسم القسم.",
        context: nextContext,
      });
    }

    if (isManualIntent(message) || isWiringIntent(message)) {
      if (!productId) {
        return res.json({
          reply: "من فضلك حدّد اسم المنتج المطلوب.",
          context: nextContext,
        });
      }
      const product = CACHE.products.get(productId);
      if (!product) {
        return res.json({ reply: "البيانات غير جاهزة الآن. حاول مرة أخرى بعد دقيقة.", context: nextContext });
      }
      if (!Array.isArray(product.pdfs) || product.pdfs.length === 0) {
        return res.json({
          reply:
            "لا توجد ملفات PDF داخل صفحة المنتج حاليًا.\n" +
            "ارسل روابط الأدلة والمخططات وسأربطها مباشرة بالمنتج.",
          context: nextContext,
        });
      }
      const label = isWiringIntent(message) ? "رابط مخطط التوصيل" : "رابط الدليل/الكتالوج";
      return res.json({ reply: `${label}:\n${product.pdfs[0]}`, context: nextContext });
    }

    if (productId) {
      const product = CACHE.products.get(productId);
      if (!product) {
        return res.json({ reply: "البيانات غير جاهزة الآن. حاول مرة أخرى بعد دقيقة.", context: nextContext });
      }

      const bullets = Array.isArray(product.bullets) ? product.bullets : [];
      let out = `معلومات من صفحة المنتج: ${product.name}\n`;
      out += bullets.length ? `- ${bullets.join("\n- ")}` : "راجع صفحة المنتج للتفاصيل.";
      out += `\n\nرابط صفحة المنتج:\n${product.url}`;

      return res.json({ reply: out, context: nextContext });
    }

    return res.json({
      reply:
        "من فضلك اكتب اسم المنتج أو نوع الطلب.\n" +
        "مثال: مواصفات الباب الأوتوماتيك\n" +
        "أو: دليل استخدام كارت كاس 2025\n" +
        "أو: عنواننا",
      context: nextContext,
    });
  } catch (err) {
    return next(err);
  }
});

// JSON error handler (prevents HTML error pages)
app.use((err, req, res, next) => {
  console.error("API Error:", err?.stack || err);
  res.status(500).json({
    reply: "حدث خطأ مؤقت. برجاء المحاولة مرة أخرى.",
    context: req.body?.context && typeof req.body.context === "object" ? req.body.context : {},
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
