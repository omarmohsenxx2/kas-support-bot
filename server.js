// server.js
const express = require("express");
const fetch = require("node-fetch"); // للثبات (حتى لو مش مستخدم حاليا)
const app = express();

app.use(express.json({ limit: "200kb" }));

// ---- Safe load knowledge.js ----
let K = {};
let KNOWLEDGE_OK = false;
let KNOWLEDGE_ERROR = null;

try {
  K = require("./knowledge");
  KNOWLEDGE_OK = true;
} catch (e) {
  KNOWLEDGE_OK = false;
  KNOWLEDGE_ERROR = String(e && (e.stack || e.message || e));
  console.error("FAILED TO LOAD ./knowledge.js");
  console.error(KNOWLEDGE_ERROR);

  // fallback minimal
  K = {
    hotline: "01146925558",
    storeUrl: "PUT_STORE_URL_HERE",
    greetings: { triggers: ["اهلا", "السلام عليكم", "hello", "hi"], reply: "أهلاً 👋" },
    branches: { list: ["فيصل"], data: { "فيصل": { address: "شارع الملك فيصل - محطة التعاون - برج الشرطة - الدور الأول - الجيزة" } } },
    departments: {},
    products: {},
    autoDoorSupportGroup: { url: "" }
  };
}

// ---- CORS ----
app.use((req, res, next) => {
  const allowedOrigins = ["https://egy-tronix.com", "https://www.egy-tronix.com"];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

process.on("unhandledRejection", (err) => console.error("UnhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("UncaughtException:", err));

function normalize(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

function tokenize(s) {
  const m = normalize(s);
  return m.split(/[^a-z0-9\u0600-\u06FF]+/).filter(Boolean);
}

function isGreeting(msg) {
  const m = normalize(msg);
  return (K.greetings?.triggers || []).some(t => {
    const tt = normalize(t);
    return tt && (m === tt || m.includes(tt));
  });
}

function isAddressIntent(msg) {
  const m = normalize(msg);
  return m.includes("عنوان") || m.includes("فرع") || m.includes("فروع") || m.includes("فين") || m.includes("مكان") || m.includes("لوكيشن") || m.includes("location");
}

function isPriceIntent(msg) {
  const m = normalize(msg);
  return m.includes("سعر") || m.includes("اسعار") || m.includes("السعر") || m.includes("price") || m.includes("كام") || m.includes("تكلف") || m.includes("تكلفة");
}

function isDeptIntent(msg) {
  const m = normalize(msg);
  return m.includes("دعم") || m.includes("مبيعات") || m.includes("تسويق") || m.includes("مشتريات") || m.includes("خدمه العملاء") || m.includes("خدمة العملاء") || m.includes("رقم") || m.includes("ارقام") || m.includes("أرقام");
}

function isManualIntent(msg) {
  const m = normalize(msg);
  return m.includes("دليل") || m.includes("كتالوج") || m.includes("catalog") || m.includes("datasheet") || m.includes("data sheet") || m.includes("manual") || m.includes("user guide") || m.includes("pdf");
}

function isDoorTopic(msg) {
  const m = normalize(msg);
  return m.includes("باب") || m.includes("فولدينج") || m.includes("اوتوماتيك") || m.includes("automatic");
}

const BRANCH_ALIASES = {
  "الفرع الرئيسي": "فيصل",
  "فرع رئيسي": "فيصل",
  "رئيسي": "فيصل",
  "الرئيسي": "فيصل",
  "الاداره": "فيصل",
  "الادارة": "فيصل",
  "اداره": "فيصل",
  "ادارة": "فيصل",
  "فيصل": "فيصل",
  "الحلميه": "حلمية الزيتون",
  "الحلمية": "حلمية الزيتون",
  "حلميه": "حلمية الزيتون",
  "حلمية": "حلمية الزيتون",
  "اسكندريه": "الإسكندرية",
  "اسكندرية": "الإسكندرية",
  "القاهره": "القاهرة"
};

function detectBranch(msg) {
  const m = normalize(msg);
  for (const [alias, branchName] of Object.entries(BRANCH_ALIASES)) {
    if (m.includes(normalize(alias))) return branchName;
  }
  const list = K.branches?.list || [];
  for (const b of list) {
    const bn = normalize(b);
    if (bn && m.includes(bn)) return b;
  }
  return null;
}

function detectDepartment(msg) {
  const m = normalize(msg);
  const deps = K.departments || {};
  for (const k of Object.keys(deps)) {
    const kk = normalize(k);
    if (kk && m.includes(kk)) return k;
  }
  if (m.includes("دعم")) return "الدعم الفني";
  if (m.includes("خدمه") || m.includes("خدمة")) return "خدمة العملاء";
  if (m.includes("مبيعات")) return "المبيعات";
  if (m.includes("تسويق")) return "التسويق";
  if (m.includes("مشتريات")) return "المشتريات";
  return null;
}

function detectProductId(msg) {
  const m = normalize(msg);
  const products = K.products || {};
  for (const [id, p] of Object.entries(products)) {
    const name = normalize(p?.name);
    if (name && m.includes(name)) return id;

    const aliases = Array.isArray(p?.aliases) ? p.aliases : [];
    for (const a of aliases) {
      const aa = normalize(a);
      if (aa && m.includes(aa)) return id;
    }
  }
  return null;
}

function formatPhones(obj) {
  const phones = (obj?.phones || []).filter(Boolean);
  const wa = (obj?.whatsapp || []).filter(Boolean);
  let out = "";
  if (phones.length) out += `ارقام الهاتف:\n- ${phones.join("\n- ")}\n`;
  if (wa.length) out += `واتساب:\n- ${wa.join("\n- ")}\n`;
  if (obj?.hours) out += `مواعيد العمل:\n${obj.hours}\n`;
  if (obj?.notes) out += `${obj.notes}\n`;
  return out.trim();
}

function doorGroupHint() {
  const g = K.autoDoorSupportGroup;
  if (!g?.url) return "";
  return `\n\nولمزيد من المعلومات وتفاصيل أكثر عن الأبواب الأوتوماتيك يمكنك الانضمام للجروب:\n${g.url}`;
}

function buildSuggestions(message, productId) {
  const m = normalize(message);
  const out = [];

  if (productId) {
    out.push({ label: "📄 دليل/كتالوج المنتج", send: "دليل " + (K.products?.[productId]?.name || "المنتج") });
    out.push({ label: "💰 أسعار المنتج", send: "سعر " + (K.products?.[productId]?.name || "المنتج") });
    out.push({ label: "🛠️ رقم الدعم الفني", send: "رقم الدعم الفني" });
  }

  if (isPriceIntent(message)) {
    return [
      { label: "🛒 زيارة المتجر الإلكتروني", send: "المتجر" },
      { label: "💰 أرقام المبيعات", send: "أرقام المبيعات" },
      { label: "☎️ الخط الساخن", send: "الخط الساخن" }
    ];
  }

  if (isAddressIntent(message)) {
    return [
      { label: "📍 عنوان الفرع الرئيسي", send: "عنوان الفرع الرئيسي" },
      { label: "📍 عنوان فرع الحلمية", send: "عنوان فرع الحلمية" },
      { label: "📍 عنوان فرع الإسكندرية", send: "عنوان فرع الإسكندرية" }
    ];
  }

  if (out.length) return out;

  return [
    { label: "📍 عناوين الفروع", send: "عناوين الفروع" },
    { label: "🛠️ رقم الدعم الفني", send: "رقم الدعم الفني" },
    { label: "💰 أرقام المبيعات", send: "أرقام المبيعات" },
    { label: "☎️ الخط الساخن", send: "الخط الساخن" }
  ];
}

function bestSnippetForProduct(productId, message) {
  const p = K.products?.[productId];
  const snippets = Array.isArray(p?.snippets) ? p.snippets : [];
  if (!snippets.length) return null;

  const msgTokens = new Set(tokenize(message));
  let best = null;
  let bestScore = 0;

  for (const s of snippets) {
    const keys = Array.isArray(s.keywords) ? s.keywords : [];
    let score = 0;
    for (const k of keys) {
      const kt = tokenize(k);
      for (const t of kt) {
        if (msgTokens.has(t)) score += 1;
      }
    }
    // bonus لو الرسالة فيها اسم المنتج
    const nameTokens = tokenize(p?.name || "");
    for (const t of nameTokens) if (msgTokens.has(t)) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  return bestScore >= 1 ? best : null;
}

function formatManuals(productId) {
  const p = K.products?.[productId];
  const manuals = Array.isArray(p?.manuals) ? p.manuals : [];
  if (!manuals.length) return `لا توجد ملفات PDF مضافة حالياً لهذا المنتج.\nرابط صفحة المنتج:\n${p?.url || ""}`.trim();

  const lines = manuals.map(m => `- ${m.title}:\n${m.url}`);
  return `دلائل/كتالوج ${p.name}:\n${lines.join("\n")}`.trim();
}

// ---- Health / Debug ----
app.get("/", (req, res) => res.send("KAS Bot is running"));

app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    knowledge_ok: KNOWLEDGE_OK,
    knowledge_error: KNOWLEDGE_ERROR,
    branches_count: (K.branches?.list || []).length,
    departments_count: Object.keys(K.departments || {}).length,
    products_count: Object.keys(K.products || {}).length,
    now: new Date().toISOString()
  });
});

// ---- Chat ----
app.post("/chat", (req, res) => {
  const message = String(req.body?.message || "");
  const context = (req.body?.context && typeof req.body.context === "object") ? req.body.context : {};
  const nextContext = { ...context, lastUserMessage: message };

  const m = normalize(message);

  // أوامر ثابتة
  if (m.includes("الخط الساخن") || (m.includes("خط") && m.includes("ساخن"))) {
    return res.json({ reply: `☎️ الخط الساخن: ${K.hotline}`, context: nextContext });
  }

  if (m.includes("جروب") && (m.includes("باب") || m.includes("ابواب") || m.includes("الأبواب"))) {
    return res.json({
      reply: `جروب كاس للدعم الفني للأبواب الأوتوماتيك:\n${K.autoDoorSupportGroup?.url || ""}`,
      context: nextContext
    });
  }

  // تحية
  if (isGreeting(message)) {
    const hotline = K.hotline ? `\n\n☎️ الخط الساخن: ${K.hotline}` : "";
    return res.json({ reply: (K.greetings?.reply || "أهلاً 👋") + hotline, context: nextContext });
  }

  // تحديث سياق المنتج
  const detectedProduct = detectProductId(message);
  if (detectedProduct) nextContext.lastProductId = detectedProduct;

  const productId = detectedProduct || nextContext.lastProductId || null;

  // أسعار
  if (isPriceIntent(message)) {
    const storeUrl = K.storeUrl || "PUT_STORE_URL_HERE";
    return res.json({
      reply:
        "لمزيد من المعلومات عن الأسعار والمواصفات الخاصة بمنتجاتنا، يمكنك زيارة متجرنا الإلكتروني:\n" +
        storeUrl,
      context: nextContext,
      suggestions: buildSuggestions(message, productId)
    });
  }

  // المتجر
  if (m === "المتجر" || m.includes("لينك المتجر") || m.includes("متجر")) {
    const storeUrl = K.storeUrl || "PUT_STORE_URL_HERE";
    return res.json({ reply: `متجر KAS الإلكتروني:\n${storeUrl}`, context: nextContext });
  }

  // أقسام
  if (isDeptIntent(message)) {
    const dept = detectDepartment(message);
    if (!dept) {
      return res.json({
        reply: `حضرتك تقصد أي قسم؟\n- ${Object.keys(K.departments || {}).join("\n- ")}`,
        context: nextContext,
        suggestions: buildSuggestions(message, productId)
      });
    }
    const d = K.departments?.[dept];
    const extra = isDoorTopic(message) ? doorGroupHint() : "";
    return res.json({
      reply: `بيانات ${dept}:\n${formatPhones(d)}${extra}`.trim(),
      context: nextContext
    });
  }

  // عناوين الفروع
  if (m.includes("عناوين الفروع")) {
    return res.json({
      reply: `من فضلك حدّد الفرع المطلوب:\n- ${(K.branches?.list || []).join("\n- ")}`,
      context: nextContext,
      suggestions: buildSuggestions("عنوان", productId)
    });
  }

  if (isAddressIntent(message)) {
    const branch = detectBranch(message);
    if (!branch) {
      return res.json({
        reply: `من فضلك حدّد الفرع المطلوب:\n- ${(K.branches?.list || []).join("\n- ")}`,
        context: nextContext,
        suggestions: buildSuggestions(message, productId)
      });
    }
    const b = K.branches?.data?.[branch];
    if (!b?.address) {
      return res.json({
        reply: `العنوان غير مُضاف بعد لفرع ${branch}.`,
        context: nextContext,
        suggestions: buildSuggestions("عنوان", productId)
      });
    }
    return res.json({
      reply: `عنوان فرع ${branch}:\n${b.address}\n${formatPhones(b) ? "\n" + formatPhones(b) : ""}`.trim(),
      context: nextContext
    });
  }

  // دليل/كتالوج
  if (isManualIntent(message)) {
    if (!productId) {
      return res.json({
        reply: "من فضلك حدّد اسم المنتج المطلوب (مثال: كاس 2025 / كاس 2021 / جولد 2030 / UPS / Inverter / ميني 8 / كامة 09).",
        context: nextContext,
        suggestions: buildSuggestions("دليل", null)
      });
    }
    return res.json({
      reply: formatManuals(productId),
      context: nextContext,
      suggestions: buildSuggestions("دليل", productId)
    });
  }

  // أي سؤال عن منتج (بحث داخل snippets + روابط)
  if (productId) {
    const p = K.products?.[productId];
    const snippet = bestSnippetForProduct(productId, message);

    let reply = "";
    if (snippet?.text) {
      reply += `${p.name}:\n${snippet.text}\n\n`;
    } else {
      reply += `${p.name}:\nلو تحب ابعتلك دليل/كتالوج المنتج اكتب: (دليل ${p.name})\n\n`;
    }

    if (p?.url) reply += `رابط صفحة المنتج:\n${p.url}\n`;
    const manuals = Array.isArray(p?.manuals) ? p.manuals : [];
    if (manuals.length) {
      reply += `\nدلائل/كتالوج:\n` + manuals.slice(0, 2).map(m => `- ${m.title}`).join("\n");
    }

    if (isDoorTopic(message)) reply += doorGroupHint();

    return res.json({
      reply: reply.trim(),
      context: nextContext,
      suggestions: buildSuggestions(message, productId)
    });
  }

  // fallback
  return res.json({
    reply: "مش فاهم سؤالك بنسبة 100%.\nاختار من الاقتراحات القريبة دي:",
    context: nextContext,
    suggestions: buildSuggestions(message, null)
  });
});

// JSON error handler
app.use((err, req, res, next) => {
  console.error("API Error:", err);
  res.status(500).json({
    reply: "حدث خطأ مؤقت. برجاء المحاولة مرة أخرى.",
    context: req.body?.context || {}
  });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log("Server running on", PORT));
