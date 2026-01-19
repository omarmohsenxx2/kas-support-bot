// server.js
const express = require("express");
const fetch = require("node-fetch"); // موجود للثبات حتى لو Node قديم
const app = express();

app.use(express.json({ limit: "200kb" }));

// ---- Safe load knowledge.js (لا يوقع السيرفر) ----
let K = {};
let KNOWLEDGE_OK = false;
let KNOWLEDGE_ERROR = null;

try {
  // لازم يكون الملف في نفس الفولدر وبالاسم EXACT: knowledge.js
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
    autoDoorSupportGroup: { url: "" },
    malfunctions: { url: "" }
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

// ---- منع سقوط مفاجئ ----
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

function buildSuggestions(message) {
  if (isPriceIntent(message)) {
    return [
      { label: "🛒 زيارة المتجر الإلكتروني", send: "المتجر" },
      { label: "💰 أرقام المبيعات", send: "أرقام المبيعات" },
      { label: "📍 عنوان الفرع الرئيسي", send: "عنوان الفرع الرئيسي" }
    ];
  }
  if (isAddressIntent(message)) {
    return [
      { label: "📍 عنوان الفرع الرئيسي", send: "عنوان الفرع الرئيسي" },
      { label: "📍 عنوان فرع الحلمية", send: "عنوان فرع الحلمية" },
      { label: "📍 عنوان فرع الإسكندرية", send: "عنوان فرع الإسكندرية" }
    ];
  }
  return [
    { label: "📍 عناوين الفروع", send: "عناوين الفروع" },
    { label: "🛠️ رقم الدعم الفني", send: "رقم الدعم الفني" },
    { label: "💰 أرقام المبيعات", send: "أرقام المبيعات" }
  ];
}

// ---- Health / Debug ----
app.get("/", (req, res) => res.send("KAS Bot is running"));

app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    knowledge_ok: KNOWLEDGE_OK,
    knowledge_error: KNOWLEDGE_ERROR,
    has_branches: !!K.branches,
    branches_count: (K.branches?.list || []).length,
    has_departments: !!K.departments,
    has_storeUrl: !!K.storeUrl,
    now: new Date().toISOString()
  });
});

// ---- Chat ----
app.post("/chat", (req, res) => {
  const message = String(req.body?.message || "");
  const context = (req.body?.context && typeof req.body.context === "object") ? req.body.context : {};
  const nextContext = { ...context, lastUserMessage: message };

  // تحية
  if (isGreeting(message)) {
    const hotline = K.hotline ? `\n\n☎️ الخط الساخن: ${K.hotline}` : "";
    return res.json({ reply: (K.greetings?.reply || "أهلاً 👋") + hotline, context: nextContext });
  }

  // سعر
  if (isPriceIntent(message)) {
    const storeUrl = K.storeUrl || "PUT_STORE_URL_HERE";
    return res.json({
      reply:
        "لمزيد من المعلومات عن الأسعار والمواصفات الخاصة بمنتجاتنا، يمكنك زيارة متجرنا الإلكتروني:\n" +
        storeUrl,
      context: nextContext,
      suggestions: buildSuggestions(message)
    });
  }

  // المتجر
  if (normalize(message) === "المتجر" || normalize(message).includes("لينك المتجر")) {
    const storeUrl = K.storeUrl || "PUT_STORE_URL_HERE";
    return res.json({ reply: `متجر KAS الإلكتروني:\n${storeUrl}`, context: nextContext });
  }

  // عناوين الفروع (قائمة)
  if (normalize(message).includes("عناوين الفروع")) {
    return res.json({
      reply: `من فضلك حدّد الفرع المطلوب:\n- ${(K.branches?.list || []).join("\n- ")}`,
      context: nextContext,
      suggestions: buildSuggestions("عنوان")
    });
  }

  // عنوان فرع
  if (isAddressIntent(message)) {
    const branch = detectBranch(message);
    if (!branch) {
      return res.json({
        reply: `من فضلك حدّد الفرع المطلوب:\n- ${(K.branches?.list || []).join("\n- ")}`,
        context: nextContext,
        suggestions: buildSuggestions(message)
      });
    }
    const b = K.branches?.data?.[branch];
    if (!b?.address) {
      return res.json({
        reply: `العنوان غير مُضاف بعد لفرع ${branch}.`,
        context: nextContext,
        suggestions: buildSuggestions("عنوان")
      });
    }
    return res.json({
      reply: `عنوان فرع ${branch}:\n${b.address}\n${formatPhones(b) ? "\n" + formatPhones(b) : ""}`.trim(),
      context: nextContext
    });
  }

  // جروب الأبواب (لو السؤال عن باب)
  if (isDoorTopic(message) && K.autoDoorSupportGroup?.url) {
    return res.json({
      reply: "تمام. " + doorGroupHint(),
      context: nextContext
    });
  }

  // fallback + suggestions
  return res.json({
    reply: "مش فاهم سؤالك بنسبة 100%.\nاختار من الاقتراحات القريبة دي:",
    context: nextContext,
    suggestions: buildSuggestions(message)
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
