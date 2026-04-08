process.env.PATH = "/opt/alt/alt-ImageMagick/usr/bin:" + (process.env.PATH || "");
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const uploadRoute = require("./routes/upload");
app.use("/api/upload", uploadRoute);

const exportRoute = require("./routes/export");
app.use("/api/export", exportRoute);

const analyzeRoute = require("./routes/analyze");
app.use("/api/analyze", analyzeRoute);

const saveImageRoute = require("./routes/save-image");
app.use("/api/save-image", saveImageRoute);

const distPath = path.join(__dirname, "client", "dist");
app.use(express.static(distPath, { index: false, etag: false, lastModified: false, maxAge: 0 }));
app.get("/{*splat}", (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  const html = fs.readFileSync(path.join(distPath, "index.html"), "utf8");
  res.type("html").send(html);
});

app.listen(PORT, () => {
  console.log("Serveur DTF demarré sur http://localhost:" + PORT);
});

module.exports = app;
