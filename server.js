const express = require("express");
const cheerio = require("cheerio");
const sources = require("./sources");

const app = express();
app.use(express.json());

// ================= CORS =================
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://egy-tronix.com",
    "https://www.egy-tronix.com"
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ================= CACHE =================
const CACHE = {
  products: new Map(),
  contactText: "",
  lastUpdate: 0
};

// ================= HELPERS =================
function clean(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .trim();
}

function normalize(text) {
  return clean(text).toLowerCase();
}

// ================= FETCH =================
async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "KASBot/1.0" }
  });
  if (!res.ok) throw new Error("Failed to fetch " + url);
  return await res.text();
}

// ================= LOAD CONTACT =================
async function loadContact() {
  const html = await fetchHTML(sources.contactUrl);
  const $ = cheerio.load(html);
  CACHE.contactText = clean($("body").text());
}

// ================= LOAD PRODUCTS =================
async function loadProduct(product) {
  const html = await fetchHTML(product.url);
  const $ = cheerio.load(html);

  const title = clean($("h1").first().text());
  const bullets = [];

  $("li").each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 5) bullets.push(t);
  });

  const pdfs = [];
  $("a[href$='.pdf']").each((_, el) => {
    pdfs.push($(el).attr("href"));
  });

  CACHE.products.set(product.id, {
    id: product.id,
    name: product.name,
    url: product.url,
    title,
    bullets: [...new Set(bullets)].slice(0, 15),
    pdfs: [...new Set(pdfs)]
  });
}

// ================= REFRESH =================
async function refreshAll() {
  await loadContact();
  for (const p of sources.products) {
    await loadProduct(p);
  }
  CACHE.lastUpdate = Date.now();
  console.log("KAS data refreshed");
}

// أول تشغيل
refreshAll().catch(console.error);

// تحديث كل 6 ساعات
setInterval(refreshAll, 6 * 60 * 60 * 1000);

// ================= DETECTION =================
function detectProduct(message) {
  const m = normalize(message);
  for (const p of sources.products) {
    if (m.includes(normalize(p.name))) return p.id;
  }
  if (m.includes("باب") && m.includes("اوتوماتيك")) return "automatic_door";
  if (m.includes("فولدينج")) return "folding_door";
  return null;
}

// ================= CHAT =================
app.post("/chat", (req, res) => {
  const message = req.body.message || "";
  const context = req.body.context || {};

  const productId = detectProduct(message) || context.lastProductId;
  const nextContext = { lastProductId: productId };

  // عنوان / تواصل
  if (normalize(message).includes("عنوان")) {
    return res.json({
      reply:
        "حضرتك تقصد إيه تحديدًا؟\n" +
        "1) عنوان فرع\n" +
        "2) دعم فني\n" +
        "3) خدمة عملاء\n" +
        "اكتب الرقم أو الاسم.",
      context: nextContext
    });
  }

  // دليل / مخطط
  if (
    normalize(message).includes("دليل") ||
    normalize(message).includes("مخطط")
  ) {
    if (!productId) {
      return res.json({
        reply: "من فضلك حدّد اسم المنتج المطلوب.",
        context: nextContext
      });
    }

    const product = CACHE.products.get(productId);
    if (!product || product.pdfs.length === 0) {
      return res.json({
        reply: "لا يوجد ملفات متاحة حاليًا لهذا المنتج.",
        context: nextContext
      });
    }

    return res.json({
      reply: "الرابط المتاح:\n" + product.pdfs[0],
      context: nextContext
    });
  }

  // معلومات منتج
  if (productId) {
    const product = CACHE.products.get(productId);
    if (!product) {
      return res.json({
        reply: "البيانات غير جاهزة الآن، حاول لاحقًا.",
        context: nextContext
      });
    }

    let text =
      "معلومات عن " +
      product.name +
      ":\n" +
      product.bullets.join("\n- ");

    text += "\n\nرابط الصفحة:\n" + product.url;

    return res.json({ reply: text, context: nextContext });
  }

  // fallback
  return res.json({
    reply:
      "من فضلك حدّد سؤالك أو اسم المنتج.\n" +
      "مثال: باب أوتوماتيك – كارت تحكم – دليل استخدام.",
    context: nextContext
  });
});

app.get("/", (req, res) => res.send("KAS Bot is running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
