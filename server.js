// server.js
const express = require("express");
const app = express();

app.use(express.json({ limit: "200kb" }));

// CORS
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://egy-tronix.com",
    "https://www.egy-tronix.com"
  ];
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

// Health check
app.get("/", (req, res) => {
  res.send("KAS Bot is running");
});

// Chat endpoint
app.post("/chat", (req, res, next) => {
  try {
    const message = String(req.body?.message || "").toLowerCase();
    const context = req.body?.context || {};

    let reply = "من فضلك وضح سؤالك بشكل أدق.";

    if (message.includes("باب")) {
      reply = "حضرتك تقصد باب أوتوماتيك أم باب فولدينج؟";
    }

    if (message.includes("كنترول") || message.includes("كارت")) {
      reply = "من فضلك حدّد اسم الكارت أو رقم الموديل.";
    }

    if (message.includes("عنوان") || message.includes("فين")) {
      reply = "هل تقصد عنوان الفرع أم التواصل مع قسم معين؟";
    }

    res.json({ reply, context });
  } catch (err) {
    next(err);
  }
});

// IMPORTANT: JSON error handler (يمنع رجوع HTML)
app.use((err, req, res, next) => {
  console.error("API Error:", err);
  res.status(500).json({
    reply: "حدث خطأ مؤقت. برجاء المحاولة مرة أخرى.",
    context: req.body?.context || {}
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
