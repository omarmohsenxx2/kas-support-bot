// server.js
const express = require("express");
const app = express();

app.use(express.json());

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

app.get("/", (req, res) => {
  res.send("KAS Bot is running ✅");
});

app.post("/chat", (req, res) => {
  const message = (req.body.message || "").toLowerCase();

  let reply = "من فضلك وضّح سؤالك أكتر 🙏";

  if (message.includes("باب")) {
    reply = "تمام 👌 باب أوتوماتيك كاس. تحب تعرف السعر ولا التركيب ولا المواصفات؟";
  }

  if (message.includes("كنترول") || message.includes("كارت")) {
    reply = "كروت التحكم من KAS متوفرة لأنظمة متعددة. قولّي نوع النظام وعدد الأدوار.";
  }

  res.json({ reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
