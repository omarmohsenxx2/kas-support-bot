const express = require("express");
const cheerio = require("cheerio");
const sources = require("./sources");

const app = express();
app.use(express.json());

// CORS: اسمح لموقعك فقط
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

// ===== قواعد صارمة =====
function stripEmoji(text) {
  // يشيل معظم الايموجي + الرموز الخاصة
  return (text || "").replace(/[\u{1F000}-\u{1FFFF}]/gu, "").trim();
}
function oneLinkOnly(text) {
  // لو النص فيه أكثر من لينك، نخليه واحد (الأول فقط)
  const urls = (text.match(/https?:\/\/\S+/g) || []);
  if (urls.length <= 1) return text;
  return text.replace(urls.slice(1).join("|"), "");
}

// ===== Cache =====
const CACHE = {
  contact: null,
  products: new Map(), // id -> { name, url, text, bullets[], pdfLinks[] }
  lastRefreshAt: 0
};

async function fetchHtml(url) {
  const r = await fetch(url, { headers: { "User-Agent": "KASBot/1.0" } });
  if (!r.ok) throw new Error("Fetch failed: " + url);
  return await r.text();
}

function cleanText(t) {
  return (t || "")
    .replace(/\s+/g, " ")
    .replace(/[•·]+/g, "-")
    .trim();
}

function extractPdfLinks($) {
  const links = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const text = cleanText($(a).text());
    if (href.toLowerCase().includes(".pdf")) {
      links.push({ url: href, text });
    }
  });
  // إزالة تكرار
  const seen = new Set();
  return links.filter(l => {
    const key = l.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractBullets($) {
  const bullets = [];
  // WooCommerce/Elementor غالبًا بيحط نقاط في ul/li
  $(".woocommerce-product-details__short-description li, .entry-content li, .product li").each((_, li) => {
    const t = cleanText($(li).text());
    if (t && t.length > 3) bullets.push(t);
  });
  // إزالة تكرار
  const seen = new Set();
  return bullets.filter(b => {
    const k = b.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 40);
}

function extractMainText($) {
  const title = cleanText($("h1").first().text());
  // نص المنتج: وصف قصير + وصف داخل المحتوى
  const shortDesc = cleanText($(".woocommerce-product-details__short-description").text());
  const content = cleanText($(".woocommerce-Tabs-panel, .entry-content, .product").first().text());
  const price = cleanText($(".price").first().text());

  // نجمع نص “مسموح” فقط من الصفحة
  const combined = [title, price ? ("السعر: " + price) : "", shortDesc, content]
    .filter(Boolean)
    .join(" | ");

  return cleanText(combined);
}

async function refreshProduct(p) {
  const html = await fetchHtml(p.url);
  const $ = cheerio.load(html);

  const text = extractMainText($);
  const bullets = extractBullets($);
  const pdfLinks = extractPdfLinks($);

  CACHE.products.set(p.id, {
    id: p.id,
    name: p.name,
    url: p.url,
    text,
    bullets,
    pdfLinks
  });
}

async function refreshContact() {
  const html = await fetchHtml(sources.contactUrl);
  const $ = cheerio.load(html);
  const pageText = cleanText($("body").text());

  // ملاحظة: احنا هنا “مش بنخمن”، بنخزن النص الخام للصفحة
  CACHE.contact = {
    url: sources.contactUrl,
    text: pageText
  };
}

async function refreshAll() {
  await refreshContact();
  for (const p of sources.products) {
    await refreshProduct(p);
  }
  CACHE.lastRefreshAt = Date.now();
}

// تحديث أول تشغيل
refreshAll().catch(() => {});

// تحديث دوري كل 6 ساعات
setInterval(() => {
  refreshAll().catch(() => {});
}, 6 * 60 * 60 * 1000);

// ===== فهم الرسائل =====
function normalize(s) {
  return (s || "").toLowerCase().trim();
}
function detectProductId(message) {
  const m = normalize(message);
  // matching بسيط: الاسم أو جزء منه
  for (const p of sources.products) {
    if (m.includes(normalize(p.name))) return p.id;
    // كلمات شائعة
    if (p.id === "automatic_door" && (m.includes("باب") && m.includes("اوتوماتيك"))) return p.id;
    if (p.id === "folding_door" && (m.includes("باب") && (m.includes("فولدينج") || m.includes("طي")))) return p.id;
  }
  return null;
}

function isAddressIntent(message) {
  const m = normalize(message);
  return m.includes("عنوان") || m.includes("مكان") || m.includes("فين") || m.includes("لوكيشن") || m.includes("location");
}
function isManualIntent(message) {
  const m = normalize(message);
  return m.includes("دليل") || m.includes("manual") || m.includes("كتالوج") || m.includes("datasheet") || m.includes("data sheet");
}
function isWiringIntent(message) {
  const m = normalize(message);
  return m.includes("مخطط") || m.includes("توصيل") || m.includes("wiring") || m.includes("diagram") || m.includes("schematic");
}

// ===== الردود (بدون ايموجي) =====
function replyText(text) {
  return oneLinkOnly(stripEmoji(text));
}

app.get("/", (req, res) => res.send("KAS Bot is running"));

app.post("/chat", (req, res) => {
  const message = (req.body.message || "").toString();
  const context = req.body.context || {};
  const m = normalize(message);

  // استخدم آخر منتج في السياق
  const detected = detectProductId(message);
  const productId = detected || context.lastProductId || null;

  const nextContext = { ...context, lastProductId: productId };

  // 1) العنوان / التواصل
  if (isAddressIntent(message)) {
    // صفحة التواصل فيها أقسام وفروع. عشان ما نلخبطش نسأل توضيح.
    return res.json({
      reply: replyText(
        "تحديدًا حضرتك تقصد عنوان أي شيء؟\n1) عنوان الفرع\n2) رقم الدعم الفني\n3) خدمة العملاء\nاكتب رقم الاختيار أو اسم القسم."
      ),
      context: nextContext
    });
  }

  // 2) دليل / كتالوج
  if (isManualIntent(message) || isWiringIntent(message)) {
    if (!productId) {
      return res.json({
        reply: replyText(
          "من فضلك حدّد المنتج المطلوب:\n- باب أوتوماتيك\n- باب فولدينج\n- كارت تحكم\n- كارت طوارئ\nاكتب اسم المنتج."
        ),
        context: nextContext
      });
    }

    const pdata = CACHE.products.get(productId);
    if (!pdata) {
      return res.json({
        reply: replyText("البيانات غير جاهزة الآن. جرّب بعد دقيقة."),
        context: nextContext
      });
    }

    // نطلع PDF من نفس صفحة المنتج إن وجد
    const wantWiring = isWiringIntent(message);
    const wantManual = isManualIntent(message);

    // فلترة كلمات داخل نص اللينك (لو موجودة)
    const candidates = pdata.pdfLinks || [];
    let chosen = null;

    const pickByKeywords = (keywords) => {
      for (const c of candidates) {
        const t = normalize(c.text || "");
        if (keywords.some(k => t.includes(k))) return c;
      }
      return null;
    };

    if (wantWiring) chosen = pickByKeywords(["مخطط", "توصيل", "wiring", "diagram", "schematic"]);
    if (!chosen && wantManual) chosen = pickByKeywords(["دليل", "manual", "كتالوج", "datasheet", "data sheet"]);

    // لو مفيش نص على اللينك، ندي أول PDF كحل مؤقت
    if (!chosen && candidates.length > 0) chosen = candidates[0];

    if (!chosen) {
      return res.json({
        reply: replyText(
          "لم يتم العثور على ملفات PDF داخل صفحة المنتج الحالية. ابعت لي روابط الأدلة والمخططات وسأربطها مباشرة بالمنتج."
        ),
        context: nextContext
      });
    }

    const label = wantWiring ? "رابط مخطط التوصيل" : "رابط الدليل/الكتالوج";
    return res.json({
      reply: replyText(label + " للمنتج:\n" + chosen.url),
      context: nextContext
    });
  }

  // 3) أسئلة عامة عن منتج (من نفس الصفحة فقط)
  if (productId) {
    const pdata = CACHE.products.get(productId);
    if (!pdata) {
      return res.json({ reply: replyText("البيانات غير جاهزة الآن. جرّب بعد دقيقة."), context: nextContext });
    }

    // نرد بنص “مسموح” من الصفحة فقط + لينك صفحة المنتج
    // بدون أي زيادات
    const answer =
      "المعلومات المتاحة عن " + pdata.name + ":\n" +
      (pdata.bullets && pdata.bullets.length ? ("- " + pdata.bullets.slice(0, 8).join("\n- ")) : pdata.text) +
      "\n\nرابط صفحة المنتج:\n" + pdata.url;

    return res.json({ reply: replyText(answer), context: nextContext });
  }

  // 4) fallback عام
  return res.json({
    reply: replyText(
      "من فضلك حدّد سؤالك.\nإذا السؤال عن منتج، اكتب اسم المنتج كما هو في المتجر.\nإذا السؤال عن التواصل، اكتب: عنوان / دعم فني / خدمة عملاء."
    ),
    context: nextContext
  });
});

// Endpoint اختياري لتحديث الكاش يدويًا
app.post("/refresh", async (req, res) => {
  try {
    await refreshAll();
    res.json({ ok: true, refreshedAt: CACHE.lastRefreshAt });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("KAS Bot running on", PORT));
