// server.js
const express = require("express");
const K = require("./knowledge");

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
  return m.includes("عنوان") || m.includes("لوكيشن") || m.includes("مكان") || m.includes("فروع") || m.includes("فرع") || m.includes("فين");
}

function isDeptIntent(msg) {
  const m = normalize(msg);
  return (
    m.includes("دعم") ||
    m.includes("الدعم الفني") ||
    m.includes("خدمه العملاء") ||
    m.includes("خدمة العملاء") ||
    m.includes("مبيعات") ||
    m.includes("تسويق") ||
    m.includes("مشتريات") ||
    m.includes("ارقام") ||
    m.includes("رقم")
  );
}

function isManualIntent(msg) {
  const m = normalize(msg);
  return m.includes("دليل") || m.includes("كتالوج") || m.includes("datasheet") || m.includes("manual") || m.includes("user guide");
}

function isWiringIntent(msg) {
  const m = normalize(msg);
  return m.includes("مخطط") || m.includes("توصيل") || m.includes("wiring") || m.includes("diagram") || m.includes("schematic");
}

function isMalfunctionsIntent(msg) {
  const m = normalize(msg);
  return m.includes("اعطال") || m.includes("اعطال") || m.includes("رموز") || m.includes("alerts") || m.includes("alarms");
}

// مرادفات للفروع (اختصارات)
const BRANCH_ALIASES = {
  "الحلميه": "حلمية الزيتون",
  "حلميه": "حلمية الزيتون",
  "الحلمية": "حلمية الزيتون",
  "حلمية": "حلمية الزيتون",
  "الاداره": "الإدارة",
  "الادارة": "الإدارة",
  "اداره": "الإدارة",
  "ادارة": "الإدارة",
  "اسكندريه": "الإسكندرية",
  "اسكندرية": "الإسكندرية",
  "القاهره": "القاهرة"
};

function detectBranch(msg) {
  const m = normalize(msg);

  // 1) alias direct match
  for (const [alias, branchName] of Object.entries(BRANCH_ALIASES)) {
    if (m.includes(normalize(alias))) return branchName;
  }

  // 2) exact list contains
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

function detectProduct(msg) {
  const m = normalize(msg);
  const products = K.products || {};
  for (const [id, p] of Object.entries(products)) {
    const name = normalize(p?.name);
    if (name && m.includes(name)) return id;

    if (id === "folding_door" && (m.includes("فولدينج") || (m.includes("باب") && m.includes("طي")))) return id;
    if (id === "automatic_door" && (m.includes("باب") && m.includes("اوتوماتيك"))) return id;
    if (id === "gold_2030" && (m.includes("جولد") && m.includes("2030"))) return id;
    if (id === "kas_2025" && m.includes("2025")) return id;
    if (id === "kas_2021" && m.includes("2021")) return id;
    if (id === "mini_8" && (m.includes("ميني") || m.includes("mini 8") || m.includes("8 وقفه") || m.includes("8 وقفة"))) return id;
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

app.get("/", (req, res) => res.send("KAS Bot is running"));

app.post("/chat", (req, res, next) => {
  try {
    const message = String(req.body?.message || "");
    const m = normalize(message);
    const context = (req.body?.context && typeof req.body.context === "object") ? req.body.context : {};
    const nextContext = { ...context };

    // ====== دعم “استكمال السؤال” (awaiting) ======
    if (nextContext.awaiting === "branch_address") {
      const branch = detectBranch(message);
      if (branch) {
        nextContext.awaiting = null;
        nextContext.lastBranch = branch;
        const b = K.branches?.data?.[branch];
        if (b?.address) {
          return res.json({
            reply: `عنوان فرع ${branch}:\n${b.address}\n${formatPhones(b) ? "\n" + formatPhones(b) : ""}`.trim(),
            context: nextContext
          });
        }
        return res.json({ reply: `العنوان غير مُضاف بعد لفرع ${branch}.`, context: nextContext });
      }
      return res.json({
        reply: `مش واضح اسم الفرع. اختار واحد من دول:\n- ${(K.branches?.list || []).join("\n- ")}`,
        context: nextContext
      });
    }

    if (nextContext.awaiting === "dept_contact") {
      const dept = detectDepartment(message);
      if (dept) {
        nextContext.awaiting = null;
        nextContext.lastDept = dept;
        const d = (K.departments || {})[dept];
        if (d) {
          let extra = "";
          if (m.includes("باب") || m.includes("فولدينج") || m.includes("اوتوماتيك")) extra = doorGroupHint();
          return res.json({ reply: `بيانات ${dept}:\n${formatPhones(d)}${extra}`.trim(), context: nextContext });
        }
      }
      return res.json({
        reply: `حضرتك تقصد أي قسم؟\n- ${Object.keys(K.departments || {}).join("\n- ")}`,
        context: nextContext
      });
    }

    if (nextContext.awaiting === "product_manual") {
      const productId = detectProduct(message);
      if (productId) {
        nextContext.awaiting = null;
        nextContext.lastProductId = productId;
        const p = (K.products || {})[productId];
        const manuals = p?.manuals || {};
        const keys = Object.keys(manuals);
        if (!keys.length) {
          return res.json({ reply: `لا توجد ادلة مضافة حاليا.\nرابط المنتج:\n${p.url || ""}`.trim(), context: nextContext });
        }
        const firstKey = keys[0];
        return res.json({ reply: `${firstKey}:\n${manuals[firstKey]}`, context: nextContext });
      }
      return res.json({
        reply: "اكتب اسم المنتج المطلوب (مثال: كاس 2025 / جولد 2030 / باب فولدينج / باب اوتوماتيك).",
        context: nextContext
      });
    }

    // ====== تحية ======
    if (isGreeting(message)) {
      const hotline = K.hotline ? `\n\n☎️ الخط الساخن: ${K.hotline}` : "";
      return res.json({ reply: (K.greetings?.reply || "أهلاً 👋") + hotline, context: nextContext });
    }

    // ====== أعطال ======
    if (isMalfunctionsIntent(message)) {
      if (K.malfunctions?.url) {
        return res.json({ reply: `رموز الاعطال والتنبيهات:\n${K.malfunctions.url}`, context: nextContext });
      }
      return res.json({ reply: "رموز الأعطال غير مضافة حالياً.", context: nextContext });
    }

    // ====== عنوان/فروع ======
    if (isAddressIntent(message)) {
      const branch = detectBranch(message);
      if (!branch) {
        nextContext.awaiting = "branch_address";
        return res.json({
          reply: `من فضلك حدّد الفرع المطلوب:\n- ${(K.branches?.list || []).join("\n- ")}`,
          context: nextContext
        });
      }
      nextContext.lastBranch = branch;
      const b = K.branches?.data?.[branch];
      if (!b?.address) {
        return res.json({ reply: `العنوان غير مُضاف بعد لفرع ${branch}.`, context: nextContext });
      }
      return res.json({
        reply: `عنوان فرع ${branch}:\n${b.address}\n${formatPhones(b) ? "\n" + formatPhones(b) : ""}`.trim(),
        context: nextContext
      });
    }

    // ====== أقسام ======
    if (isDeptIntent(message)) {
      const dept = detectDepartment(message);
      if (!dept) {
        nextContext.awaiting = "dept_contact";
        return res.json({
          reply: `حضرتك تقصد أي قسم؟\n- ${Object.keys(K.departments || {}).join("\n- ")}`,
          context: nextContext
        });
      }
      nextContext.lastDept = dept;
      const d = (K.departments || {})[dept];
      if (!d) return res.json({ reply: `القسم غير موجود حالياً: ${dept}`, context: nextContext });

      let extra = "";
      if (m.includes("باب") || m.includes("فولدينج") || m.includes("اوتوماتيك")) extra = doorGroupHint();

      return res.json({ reply: `بيانات ${dept}:\n${formatPhones(d)}${extra}`.trim(), context: nextContext });
    }

    // ====== أدلة/مخططات ======
    if (isManualIntent(message) || isWiringIntent(message)) {
      const productId = detectProduct(message) || nextContext.lastProductId || null;
      if (!productId) {
        nextContext.awaiting = "product_manual";
        return res.json({ reply: "من فضلك حدّد اسم المنتج المطلوب لإرسال الدليل/المخطط.", context: nextContext });
      }
      nextContext.lastProductId = productId;
      const p = (K.products || {})[productId];
      const manuals = p?.manuals || {};
      const keys = Object.keys(manuals);
      if (!keys.length) {
        return res.json({ reply: `لا توجد ادلة مضافة حاليا.\nرابط المنتج:\n${p.url || ""}`.trim(), context: nextContext });
      }
      const firstKey = keys[0];
      return res.json({ reply: `${firstKey}:\n${manuals[firstKey]}`, context: nextContext });
    }

    // ====== منتج ======
    const productId = detectProduct(message);
    if (productId) {
      nextContext.lastProductId = productId;
      const p = (K.products || {})[productId];
      const specs = Array.isArray(p?.specs) ? p.specs.filter(Boolean) : [];
      const extra = (productId === "automatic_door" || productId === "folding_door") ? doorGroupHint() : "";
      if (specs.length) {
        return res.json({ reply: `${p.name}:\n- ${specs.join("\n- ")}\n\nرابط المنتج:\n${p.url || ""}${extra}`.trim(), context: nextContext });
      }
      return res.json({ reply: `رابط صفحة المنتج:\n${p.url || ""}${extra}`.trim(), context: nextContext });
    }

    // ====== fallback واضح ======
    return res.json({
      reply:
        "اكتب سؤالك بالشكل ده عشان أرد بسرعة:\n" +
        "- عنوان فرع (مثال: عنوان فرع الحلمية)\n" +
        "- رقم الدعم الفني\n" +
        "- أرقام المبيعات\n" +
        "- دليل + اسم المنتج\n\n" +
        (K.hotline ? `☎️ الخط الساخن: ${K.hotline}` : ""),
      context: nextContext
    });
  } catch (err) {
    next(err);
  }
});

// JSON error handler
app.use((err, req, res, next) => {
  console.error("API Error:", err);
  res.status(500).json({
    reply: "حدث خطأ مؤقت. برجاء المحاولة مرة أخرى.",
    context: req.body?.context || {}
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
