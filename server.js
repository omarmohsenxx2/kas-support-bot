// server.js
const express = require("express");
const app = express();

app.use(express.json({ limit: "200kb" }));

// CORS
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

// ---- Load knowledge safely ----
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

  // minimal fallback
  K = {
    hotline: "01146925558",
    storeUrl: "",
    greetings: { triggers: ["اهلا", "السلام عليكم", "hello", "hi"], reply: "أهلاً 👋" },
    branches: { list: [], data: {} },
    departments: {},
    products: {},
    autoDoorSupportGroup: { url: "" }
  };
}

// Never crash the process
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

function safeArray(x) { return Array.isArray(x) ? x : []; }
function safeObj(x) { return x && typeof x === "object" ? x : {}; }

function isGreeting(msg) {
  const m = normalize(msg);
  return safeArray(K.greetings?.triggers).some(t => {
    const tt = normalize(t);
    return tt && (m === tt || m.includes(tt));
  });
}

function isManualIntent(msg) {
  const m = normalize(msg);
  return (
    m.includes("دليل") ||
    m.includes("ادله") ||
    m.includes("أدلة") ||
    m.includes("كتالوج") ||
    m.includes("manual") ||
    m.includes("datasheet") ||
    m.includes("pdf") ||
    m.includes("برشور") ||
    m.includes("فلاير")
  );
}

function hasWord(m, w) {
  // كلمة كاملة: بداية/مسافة + الكلمة + نهاية/مسافة
  const re = new RegExp("(^|\\s)" + w + "(\\s|$)");
  return re.test(m);
}

function isPriceIntent(msg) {
  const m = normalize(msg);
  // مهم: "كام" لازم تكون كلمة لوحدها عشان ما تمسكش في "كامه/كامة"
  return (
    m.includes("سعر") ||
    m.includes("اسعار") ||
    m.includes("price") ||
    hasWord(m, "كام") ||
    m.includes("تكلف") ||
    m.includes("تكلفة")
  );
}

function isAddressIntent(msg) {
  const m = normalize(msg);
  return m.includes("عنوان") || m.includes("فرع") || m.includes("فروع") || m.includes("فين") || m.includes("مكان");
}

function isDeptIntent(msg) {
  const m = normalize(msg);
  return m.includes("دعم") || m.includes("مبيعات") || m.includes("تسويق") || m.includes("مشتريات") || m.includes("خدمة العملاء") || m.includes("خدمه العملاء") || m.includes("رقم") || m.includes("ارقام") || m.includes("أرقام");
}

function formatPhones(obj) {
  const o = safeObj(obj);
  const phones = safeArray(o.phones).filter(Boolean);
  let out = "";
  if (phones.length) out += `ارقام الهاتف:\n- ${phones.join("\n- ")}\n`;
  if (o.notes) out += `${o.notes}\n`;
  return out.trim();
}

// ---- Build product index once ----
const PRODUCTS = safeObj(K.products);
const PRODUCT_LIST = Object.entries(PRODUCTS).map(([id, p]) => ({ id, p: safeObj(p) }));

function detectProductId(message) {
  const m = normalize(message);
  for (const { id, p } of PRODUCT_LIST) {
    const name = normalize(p.name || "");
    if (name && m.includes(name)) return id;
    for (const a of safeArray(p.aliases)) {
      const aa = normalize(a);
      if (aa && m.includes(aa)) return id;
    }
  }
  return null;
}

function manualsFor(productId) {
  const p = safeObj(PRODUCTS[productId]);
  const manuals = safeArray(p.manuals);
  if (!p.name) return "المنتج غير معروف حالياً.";
  if (!manuals.length) {
    return `لا توجد ملفات PDF مضافة حالياً لـ ${p.name}.\nرابط صفحة المنتج:\n${p.url || ""}`.trim();
  }
  return `أدلة/كتالوج ${p.name}:\n` + manuals.map(m => `- ${(m && m.title) || "ملف"}:\n${(m && m.url) || ""}`).join("\n");
}

function suggestionsByType(type) {
  const out = [];
  for (const { id, p } of PRODUCT_LIST) {
    if (p.type === type && p.name) out.push({ label: p.name, send: "دليل " + p.name });
  }
  return out;
}

function manualSuggestions(message) {
  const m = normalize(message);

  // دليل كارت
  if (m.includes("كارت") || m.includes("كنترول") || m.includes("board") || m.includes("card")) {
    return suggestionsByType("cards").concat(suggestionsByType("power"));
  }

  // دليل باب
  if (m.includes("باب") || m.includes("door") || m.includes("doors")) {
    const s = suggestionsByType("doors");
    s.push({ label: "👥 جروب دعم الأبواب الأوتوماتيك", send: "جروب دعم الأبواب" });
    return s;
  }

  // دليل كامة
  if (m.includes("كامة") || m.includes("كامه") || m.includes("cam")) {
    return suggestionsByType("cams");
  }

  // دليل فقط
  return [
    { label: "📄 أدلة الكروت", send: "دليل كارت" },
    { label: "📄 أدلة الأبواب", send: "دليل باب" },
    { label: "📄 أدلة الكامات", send: "دليل كامة" }
  ];
}

// ---- Routes ----
app.get("/", (req, res) => res.send("KAS Bot is running"));

app.get("/debug", (req, res) => {
  res.json({
    ok: true,
    knowledge_ok: KNOWLEDGE_OK,
    knowledge_error: KNOWLEDGE_ERROR,
    products_count: PRODUCT_LIST.length,
    branches_count: safeArray(K.branches?.list).length,
    departments_count: Object.keys(safeObj(K.departments)).length,
    now: new Date().toISOString()
  });
});

app.post("/chat", (req, res) => {
  try {
    const message = String(req.body?.message || "");
    const context = safeObj(req.body?.context);
    const nextContext = { ...context };

    const m = normalize(message);

    // greeting
    if (isGreeting(message)) {
      return res.json({
        reply: (K.greetings?.reply || "أهلاً 👋") + (K.hotline ? `\n\n☎️ الخط الساخن: ${K.hotline}` : ""),
        context: nextContext,
        suggestions: [
          { label: "📄 أدلة الاستخدام", send: "دليل" },
          { label: "📄 دليل كارت", send: "دليل كارت" },
          { label: "📄 دليل باب", send: "دليل باب" },
          { label: "📄 دليل كامة", send: "دليل كامة" },
          { label: "🛒 المتجر", send: "المتجر" }
        ]
      });
    }

    // update product context
    const detectedProduct = detectProductId(message);
    if (detectedProduct) nextContext.lastProductId = detectedProduct;
    const productId = detectedProduct || nextContext.lastProductId || null;

    // store
    if (m === "المتجر" || m.includes("متجر")) {
      return res.json({ reply: `متجر KAS الإلكتروني:\n${K.storeUrl || ""}`, context: nextContext });
    }

    // price
    if (isPriceIntent(message)) {
      return res.json({
        reply:
          "لمزيد من المعلومات عن الأسعار والمواصفات الخاصة بمنتجاتنا، يمكنك زيارة متجرنا الإلكتروني:\n" +
          (K.storeUrl || ""),
        context: nextContext,
        suggestions: [
          { label: "🛒 زيارة المتجر", send: "المتجر" },
          { label: "💰 أرقام المبيعات", send: "أرقام المبيعات" }
        ]
      });
    }

    // door support group
    if (m.includes("جروب") && (m.includes("باب") || m.includes("ابواب") || m.includes("الأبواب"))) {
      return res.json({
        reply: `جروب كاس للدعم الفني للأبواب الأوتوماتيك:\n${K.autoDoorSupportGroup?.url || ""}`,
        context: nextContext
      });
    }

// manuals
if (isManualIntent(message)) {
  // أوامر الأقسام فقط (بدون اسم منتج)
  const isCategoryOnly =
    m === "دليل" ||
    m === "ادله" ||
    m === "ادله الاستخدام" ||
    m === "أدلة" ||
    m === "أدلة الاستخدام" ||
    m === "دليل كارت" ||
    m === "دليل باب" ||
    m === "دليل كامه" ||
    m === "دليل كامة";

  // لو المستخدم طلب قسم عام أو المنتج مش معروف → اعرض أزرار الاختيار
  if (!productId || isCategoryOnly) {
    return res.json({
      reply: "اختار الدليل اللي محتاجه من الأزرار 👇",
      context: nextContext,
      suggestions: manualSuggestions(message)
    });
  }

  // لو فيه منتج معروف → اعرض ملفات المنتج مباشرة
  return res.json({ reply: manualsFor(productId), context: nextContext });
}

    // branches
if (m.includes("عناوين الفروع")) {
  const branches = safeArray(K.branches?.list);
  return res.json({
    reply: "اختار الفرع من الأزرار 👇",
    context: nextContext,
    suggestions: branches.map(b => ({ label: b, send: "عنوان " + b }))
  });
}

    if (isAddressIntent(message)) {
      // detect basic aliases
      const aliases = {
        "الفرع الرئيسي": "فيصل",
        "الرئيسي": "فيصل",
        "الاداره": "فيصل",
        "الادارة": "فيصل",
        "ادارة": "فيصل",
        "فيصل": "فيصل",
        "الحلميه": "حلمية الزيتون",
        "الحلمية": "حلمية الزيتون",
        "اسكندرية": "الإسكندرية",
        "اسكندريه": "الإسكندرية",
        "القاهره": "القاهرة"
      };
      let branch = null;
      for (const k of Object.keys(aliases)) {
        if (m.includes(normalize(k))) { branch = aliases[k]; break; }
      }
      if (!branch) {
        for (const b of safeArray(K.branches?.list)) {
          if (m.includes(normalize(b))) { branch = b; break; }
        }
      }
      if (!branch) {
        return res.json({
          reply: `من فضلك حدّد الفرع:\n- ${safeArray(K.branches?.list).join("\n- ")}`,
          context: nextContext
        });
      }
      const bdata = safeObj(K.branches?.data?.[branch]);
      return res.json({ reply: `عنوان فرع ${branch}:\n${bdata.address || "غير مُضاف بعد"}`, context: nextContext });
    }
    
// departments list buttons
if (m.includes("ارقام الاقسام") || m.includes("أرقام الأقسام") || m.includes("اقسام") || m.includes("الأقسام")) {
  const deps = safeObj(K.departments);
  const keys = Object.keys(deps);
  return res.json({
    reply: "اختار القسم من الأزرار 👇",
    context: nextContext,
    suggestions: keys.map(k => ({ label: k, send: "رقم " + k }))
  });
}

    // departments
    if (isDeptIntent(message)) {
      const deps = safeObj(K.departments);
      let dept = null;
      for (const k of Object.keys(deps)) {
        if (m.includes(normalize(k))) { dept = k; break; }
      }
      if (!dept) {
        if (m.includes("دعم")) dept = "الدعم الفني";
        else if (m.includes("مبيعات")) dept = "المبيعات";
        else if (m.includes("تسويق")) dept = "التسويق";
        else if (m.includes("مشتريات")) dept = "المشتريات";
        else if (m.includes("خدمة") || m.includes("خدمه")) dept = "خدمة العملاء";
      }

if (!dept || !deps[dept]) {
  const keys = Object.keys(deps);
  return res.json({
    reply: "حضرتك تقصد أي قسم؟ اختار من الأزرار 👇",
    context: nextContext,
    suggestions: keys.map(k => ({ label: k, send: "رقم " + k }))
  });
}
      return res.json({ reply: `بيانات ${dept}:\n${formatPhones(deps[dept])}`, context: nextContext });
    }

    // if message contains product name, show quick buttons
    if (productId) {
      const p = safeObj(PRODUCTS[productId]);
      return res.json({
        reply: `${p.name || "المنتج"}\nلو محتاج دليل الاستخدام اضغط الزر 👇`,
        context: nextContext,
        suggestions: [
          { label: "📄 دليل/كتالوج " + (p.name || "المنتج"), send: "دليل " + (p.name || "") },
          { label: "💰 أسعار " + (p.name || "المنتج"), send: "سعر " + (p.name || "") }
        ]
      });
    }

    // fallback
    return res.json({
      reply: "اكتب: (أدلة الاستخدام) أو (دليل كارت/باب/كامة) أو اسم المنتج.",
      context: nextContext,
      suggestions: [
        { label: "📄 أدلة الاستخدام", send: "دليل" },
        { label: "📄 دليل كارت", send: "دليل كارت" },
        { label: "📄 دليل باب", send: "دليل باب" },
        { label: "📄 دليل كامة", send: "دليل كامة" },
        { label: "🛒 المتجر", send: "المتجر" }
      ]
    });
  } catch (err) {
    console.error("Chat Handler Error:", err);
    return res.status(200).json({
      reply: "حدث خطأ مؤقت. برجاء المحاولة مرة أخرى.",
      context: {}
    });
  }
});

// Always JSON
app.use((err, req, res, next) => {
  console.error("API Error:", err);
  res.status(500).json({
    reply: "حدث خطأ مؤقت. برجاء المحاولة مرة أخرى.",
    context: req.body?.context || {}
  });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log("Server running on", PORT));
