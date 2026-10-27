
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
    encrypt: false,
    trustServerCertificate: true
    
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
  const recibida = req.headers["x-api-key"];

  // DIAGNOSTICO TEMPORAL
  console.log("DIAGNOSTICO_AUTENTICACION", {
    variableConfigurada: Boolean(apiKey),
    encabezadoRecibido: Boolean(recibida),
    coincide: Boolean(apiKey) && recibida === apiKey
  });

  // VALIDACION DE LA CLAVE
  if (!apiKey || !recibida || recibida !== apiKey) {
    return res.status(401).json({
      error: "No autorizado."
    });
  }

  next();
}

function validarAsignaciones(datos) {
  const errores = [];

  if (!Array.isArray(datos)) {
    return {
      valido: false,
      errores: ["La raíz del JSON debe ser un arreglo."]
    };
  }

  if (datos.length === 0) {
    errores.push("El arreglo debe contener al menos una asignación.");
  }

  datos.forEach((item, i) => {
    const prefijo = `Registro ${i + 1}`;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errores.push(`${prefijo}: debe ser un objeto.`);
      return;
    }

    if (!item.cliente || typeof item.cliente !== "object") {
      errores.push(`${prefijo}: falta el objeto cliente.`);
    } else {
      if (!item.cliente.numero) {
        errores.push(`${prefijo}: falta cliente.numero.`);
      }
    }

    if (!Array.isArray(item.contrato) || item.contrato.length === 0) {
      errores.push(`${prefijo}: contrato debe ser un arreglo con al menos un elemento.`);
    } else {
      item.contrato.forEach((contrato, j) => {
        if (!contrato.numeroContrato) {
          errores.push(
            `${prefijo}: falta numeroContrato en contrato ${j + 1}.`
          );
        }
      });
    }

    if (!Array.isArray(item.telefono)) {
      errores.push(`${prefijo}: telefono debe ser un arreglo.`);
    }

    if (!Array.isArray(item.direccion)) {
      errores.push(`${prefijo}: direccion debe ser un arreglo.`);
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
    console.log("[POST] Conexión obtenida; usuario:", process.env.DB_USER);

    const result = await pool.request().query(
      "SELECT @@VERSION AS versionSQL, DB_NAME() AS baseDatos"
    );

    res.json({
      estado: "conectado",
      baseDatos: result.recordset[0].baseDatos,
      versionSQL: result.recordset[0].versionSQL
    });
  } catch (err) {
    console.error("[POST SQL]", {
  code: err.code,
  message: err.message,
  originalCode: err.originalError?.code,
  originalMessage: err.originalError?.message
});

    res.status(503).json({
      estado: "sin conexión a SQL Server",
      codigo: err.code || err.name
    });
  }
});


app.post("/api/v1/asignaciones", async (req, res) => {
  const resultado = validarAsignaciones(req.body);

  if (!resultado.valido) {
    return res.status(422).json({
      error: "JSON con estructura incorrecta.",
      detalles: resultado.errores
    });
  }

  try {
    console.log("[POST] Paso 1: obteniendo conexión SQL");

    const pool = await getPool();

    console.log("[POST] Paso 2: conexión obtenida");

    const contenido = JSON.stringify(req.body);
    const nombreArchivo = String(
      req.get("x-filename") || "asignaciones.json"
    ).slice(0, 255);

    console.log("[POST] Paso 3: ejecutando GuardarAsignacionJSON");

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

    console.log("[POST] Paso 4: guardado correcto");

    return res.status(201).json({
      mensaje: "JSON validado y almacenado.",
      id: result.recordset?.[0]?.IdRegistro
    });

  } catch (err) {
    console.error("[POST ERROR]", {
      code: err.code,
      message: err.message,
      originalCode: err.originalError?.code,
      originalMessage: err.originalError?.message
    });

    return res.status(500).json({
      error: "Error al procesar el JSON",
      codigo: err.code || err.name
    });
  }
});


const port = Number(process.env.PORT || 3000);

app.listen(port, "0.0.0.0", () => {
  console.log(`API iniciada en puerto ${port}`);
});
