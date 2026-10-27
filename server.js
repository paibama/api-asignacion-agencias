
const express = require("express");
const sql = require("mssql");

const app = express();
app.use(express.json({ limit: "10mb" }));

const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  connectionTimeout: 15000,
  requestTimeout: 30000,

  options: {
    encrypt: true,
    trustServerCertificate: false
  },

  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

function autenticar(req, res, next) {
  const apiKey = process.env.API_KEY;

  if (!apiKey || req.get("x-api-key") !== apiKey) {
    return res.status(401).json({
      error: "No autorizado."
    });
  }

  next();
}

function validarAsignaciones(data) {
  const errores = [];

  if (!Array.isArray(data)) {
    return {
      valido: false,
      errores: ["La raíz del JSON debe ser un arreglo."]
    };
  }

  if (data.length === 0) {
    errores.push("El arreglo no debe estar vacío.");
  }

  if (data.length > 500) {
    errores.push("Máximo 500 registros por solicitud.");
  }

  data.forEach((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      errores.push(`Registro ${i}: debe ser un objeto.`);
      return;
    }

    if (!r.cliente || typeof r.cliente !== "object" ||
        Array.isArray(r.cliente)) {
      errores.push(`Registro ${i}: cliente debe ser un objeto.`);
    } else if (typeof r.cliente.numero !== "string" ||
               !r.cliente.numero.trim()) {
      errores.push(`Registro ${i}: falta cliente.numero.`);
    }

    for (const campo of ["contrato", "telefono", "direccion"]) {
      if (!Array.isArray(r[campo])) {
        errores.push(`Registro ${i}: ${campo} debe ser un arreglo.`);
      }
    }

    if (Array.isArray(r.contrato)) {
      if (r.contrato.length === 0) {
        errores.push(`Registro ${i}: debe incluir al menos un contrato.`);
      }

      r.contrato.forEach((c, j) => {
        if (!c || typeof c.numeroContrato !== "string" ||
            !c.numeroContrato.trim()) {
          errores.push(
            `Registro ${i}, contrato ${j}: falta numeroContrato.`
          );
        }
      });
    }
  });

  return {
    valido: errores.length === 0,
    errores
  };
}

app.get("/", (req, res) => {
  res.json({
    servicio: "API AsignacionAgencias",
    estado: "activo"
  });
});


app.get("/health", async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(
      "SELECT @@VERSION AS versionSQL, DB_NAME() AS baseDatos"
    );

    res.json({
      estado: "conectado",
      baseDatos: result.recordset[0].baseDatos,
      versionSQL: result.recordset[0].versionSQL
    });
  } catch (err) {
    console.error("DIAGNOSTICO_SQL", {
      code: err.code,
      message: err.message,
      name: err.name,
      originalCode: err.originalError?.code,
      originalMessage: err.originalError?.message,
      stack: err.stack
    });

    res.status(503).json({
      estado: "sin conexión a SQL Server",
      codigo: err.code || err.name
    });
  }
});

app.post(
  "/api/v1/asignaciones",
  autenticar,
  async (req, res) => {
    const resultado = validarAsignaciones(req.body);

    if (!resultado.valido) {
      return res.status(422).json({
        error: "JSON con estructura incorrecta.",
        detalles: resultado.errores
      });
    }

    try {
      const pool = await getPool();

      const contenido = JSON.stringify(req.body);
      const nombreArchivo = String(
        req.get("x-filename") || "asignaciones.json"
      ).slice(0, 255);

      const result = await pool.request()
        .input("NombreArchivo", sql.NVarChar(255), nombreArchivo)
        .input("ContenidoJSON", sql.NVarChar(sql.MAX), contenido)
        .input("Valido", sql.Bit, true)
        .input(
          "Mensaje",
          sql.NVarChar(1000),
          "Validación de estructura correcta."
        )
        .execute("dbo.GuardarAsignacionJSON");

      res.status(201).json({
        mensaje: "JSON validado y almacenado.",
        id: result.recordset?.[0]?.IdRegistro
      });
    } catch (err) {
      console.error("DIAGNOSTICO_SQL", {
        code: err.code,
        message: err.message,
        name: err.name,
        originalCode: err.originalError?.code,
        originalMessage: err.originalError?.message,
        stack: err.stack
      });

      res.status(503).json({
        estado: "sin conexión a SQL Server",
        codigo: err.code || err.name
      });
    }
  }
);

const port = Number(process.env.PORT || 3000);

app.listen(port, "0.0.0.0", () => {
  console.log(`API iniciada en puerto ${port}`);
});
