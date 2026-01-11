const express = require("express");
const cheerio = require("cheerio");
const sources = require("./sources");

// fetch for Node (Railway-safe)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

// Anti-crash guards
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

const app = express();
app.use(express.json());

// ================= CORS =================
app.use((req, res, next) => {
  const allowedOrigins = ["https://egy-tronix.com", "https://www.egy-tronix.com"];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ================= CACHE =================
const CACHE = {
  products: new Map(),
  contactText: "",
  lastUpdate: 0,
};

// ================= HELPERS =================
function clean(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    // remove emoji ranges
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .trim();
}

function normalize(text) {
  return clean(text).toLowerCase();
}

// ================= FETCH =================
async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "KASBot/1.0" },
    // timeout hardening
    redirect: "follow",
  });
  if (!res.ok) throw new Error("Failed to fetch: " + url + " status=" + res.status);
  return await res.text();
}

// ================= LOAD CONTACT =================
async function loadContact() {
  try {
    const html = await fetchHTML(sources.contactUrl);
    const $ = cheerio.load(html);
    CACHE.contactText = clean($("body").text());
  } catch (e) {
    console.error("loadContact error:", e);
    // do not crash; keep old cached value
  }
}

// ================= LOAD PRODUCTS =================
async function loadProduct(product) {
  try {
    const html = await fetchHTML(product.url);
    const $ = cheerio.load(html);

    const title = clean($("h1").first().text());

    // bullets: take LI items but avoid crazy long ones
    const bullets = [];
    $("li").each((_, el) => {
      const t = clean($(el).text());
      if (t.length > 5 && t.length < 220) bullets.push(t);
    });

    // pdf links
    const pdfs = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (href.toLowerCase().includes(".pdf")) pdfs.push(href);
    });

    CACHE.products.set(product.id, {
      id: product.id,
      name: product.name,
      url: product.url,
      title,
      bullets: [...new Set(bullets)].slice(0, 18),
      pdfs: [...new Set(pdfs)].slice(0, 10),
    });
  } catch (e) {
    console.error("loadProduct error:", product.url, e);
    // do not crash; keep old cached value if exists
  }
}

// ================= REFRESH =================
async function refreshAll() {
  await loadContact();

  // refresh products one by one (never throw out)
  for (const p of sources.products) {
    await loadProduct(p);
  }

  CACHE.lastUpdate = Date.now();
  console.log("KAS cache refreshed at", new Date(CACHE.lastUpdate).toISOString());
}

// First refresh
refreshAll().catch((e) => console.error("Refresh failed:", e));

// Refresh every 6 hours, safe
setInterval(() => {
  refreshAll().catch((e) => console.error("Refresh failed:", e));
}, 6 * 60 * 60 * 1000);

// ================= DETECTION =================
function detectProduct(message) {
  const m = normalize(message);

  // direct name match
  for (const p of sources.products) {
    const pn = normalize(p.name);
    if (pn && m.includes(pn)) return p.id;
  }

  // simple synonyms (you can extend later)
  if (m.includes("باب") && (m.includes("اوتوماتيك") || m.includes("أوتوماتيك"))) return "automatic_door";
  if (m.includes("باب") && (m.includes("فولدينج") || m.includes("طي"))) return "folding_door";

  return null;
}

function isAddressIntent(message) {
  const m = normalize(message);
  return m.includes("عنوان") || m.includes("مكان") || m.includes("لوكيشن") || m.includes("location") || m.includes("فين");
}

function isManualIntent(message) {
  const m = normalize(message);
  return m.includes("دليل") || m.includes("manual") || m.includes("كتالوج") || m.includes("datasheet") || m.includes("data sheet");
}

function isWiringIntent(message) {
  const m = normalize(message);
  return m.includes("مخطط") || m.includes("توصيل") || m.includes("wiring") || m.includes("diagram") || m.includes("schematic");
}

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.send("KAS Bot is running");
});

// Optional: manual refresh
app.post("/refresh", async (req, res) => {
  try {
    await refreshAll();
    return res.json({ ok: true, refreshedAt: CACHE.lastUpdate });
  } catch (e) {
    console.error("Manual refresh error:", e);
    return res.status(500).json({ ok: false });
  }
});

app.post("/chat", (req, res) => {
  try {
    const message = req.body && req.body.message ? String(req.body.message) : "";
    const context = req.body && req.body.context ? req.body.context : {};

    const detected = detectProduct(message);
    const productId = detected || context.lastProductId || null;
    const nextContext = { lastProductId: productId };

    // Address / contact
    if (isAddressIntent(message)) {
      return res.json({
        reply:
          "تحديدًا تقصد أي قسم من صفحة التواصل؟\n" +
          "1) عنوان الفرع\n" +
          "2) الدعم الفني\n" +
          "3) خدمة العملاء\n" +
          "اكتب رقم الاختيار أو اسم القسم.",
        context: nextContext,
      });
    }

    // Manual / wiring
    if (isManualIntent(message) || isWiringIntent(message)) {
      if (!productId) {
        return res.json({
          reply:
            "من فضلك حدّد اسم المنتج المطلوب.\n" +
            "مثال: باب أوتوماتيك كاس\n" +
            "أو: كارت تحكم مصعد كاس 2025",
          context: nextContext,
        });
      }

      const product = CACHE.products.get(productId);
      if (!product) {
        return res.json({
          reply: "البيانات غير جاهزة الآن. حاول مرة أخرى بعد دقيقة.",
          context: nextContext,
        });
      }

      if (!Array.isArray(product.pdfs) || product.pdfs.length === 0) {
        return res.json({
          reply:
            "لا توجد ملفات PDF متاحة داخل صفحة المنتج حاليًا.\n" +
            "ارسل روابط الأدلة والمخططات وسأربطها مباشرة بالمنتج.",
          context: nextContext,
        });
      }

      // Give one link only (first pdf)
      const label = isWiringIntent(message) ? "رابط مخطط التوصيل" : "رابط الدليل/الكتالوج";
      return res.json({
        reply: label + ":\n" + product.pdfs[0],
        context: nextContext,
      });
    }

    // Product info
    if (productId) {
      const product = CACHE.products.get(productId);
      if (!product) {
        return res.json({
          reply: "البيانات غير جاهزة الآن. حاول مرة أخرى بعد دقيقة.",
          context: nextContext,
        });
      }

      const bullets = Array.isArray(product.bullets) ? product.bullets : [];
      let out = "معلومات من صفحة المنتج: " + product.name + "\n";

      if (bullets.length) {
        out += "- " + bullets.join("\n- ");
      } else {
        out += "راجع صفحة المنتج للتفاصيل.";
      }

      out += "\n\nرابط صفحة المنتج:\n" + product.url;

      return res.json({ reply: out, context: nextContext });
    }

    // Fallback
    return res.json({
      reply:
        "من فضلك اكتب اسم المنتج أو نوع الطلب.\n" +
        "مثال: مواصفات الباب الأوتوماتيك\n" +
        "أو: دليل استخدام كارت كاس 2025\n" +
        "أو: عنواننا",
      context: nextContext,
    });
  } catch (err) {
    console.error("Chat route error:", err);
    return res.json({
      reply: "حدث خطأ مؤقت. برجاء المحاولة مرة أخرى.",
      context: (req.body && req.body.context) ? req.body.context : {},
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
