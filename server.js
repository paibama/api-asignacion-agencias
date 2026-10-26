
const express = require("express");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({
    estado: "activo",
    mensaje: "API de asignacion de agencias funcionando"
  });
});

app.post("/api/agencias", (req, res) => {
  if (!req.body || typeof req.body !== "object" ||
      Array.isArray(req.body)) {
    return res.status(400).json({
      error: "Se requiere un objeto JSON valido"
    });
  }

  res.status(201).json({
    mensaje: "Datos recibidos correctamente",
    datos: req.body
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API activa en puerto ${PORT}`);
});
