
const express = require("express");
const sql = require("mssql");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "20mb" }));

// Configuración de SQL Server
const dbConfig = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  connectionTimeout: 30000,
  requestTimeout: 120000,

  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },

  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate:
      process.env.DB_TRUST_CERT === "true",
    enableArithAbort: true
  }
};

// Pool de conexiones
let poolPromise;

function obtenerPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig)
      .connect()
      .catch((error) => {
        poolPromise = null;
        throw error;
      });
  }

  return poolPromise;
}

// Validar variables de entorno
function validarConfiguracion() {
  const requeridas = [
    "DB_SERVER",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "API_KEY"
  ];

  return requeridas.filter(
    (nombre) => !process.env[nombre]
  );
}

// Diagnóstico de errores SQL: únicamente en los logs
function registrarError(etiqueta, error) {
  console.error(etiqueta, {
    message: error.message,
    code: error.code,
    number: error.number,
    state: error.state,
    class: error.class,
    lineNumber: error.lineNumber,
    procedure: error.procName,
    originalError: error.originalError?.message,
    precedingErrors: error.precedingErrors?.map((e) => ({
      message: e.message,
      number: e.number,
      state: e.state
    }))
  });
}

// Estado de la API
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    servicio: "API de asignaciones",
    estado: "activo"
  });
});

// Comprobar conexión a SQL Server
app.get("/health/db", async (req, res) => {
  try {
    const faltantes = validarConfiguracion();

    if (faltantes.length > 0) {
      return res.status(500).json({
        ok: false,
        mensaje: "Faltan variables de entorno",
        variables: faltantes
      });
    }

    const pool = await obtenerPool();

    await pool.request().query(
      "SELECT 1 AS conectado"
    );

    return res.status(200).json({
      ok: true,
      mensaje: "Conexión a SQL Server correcta"
    });

  } catch (error) {
    registrarError("[HEALTH DB]", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Sin conexión a SQL Server",
      codigo: error.code || "DB_ERROR"
    });
  }
});

// Recibir JSON y ejecutar el procedimiento almacenado
app.post("/api/v1/asignaciones", async (req, res) => {
  console.log("[POST] Solicitud de asignaciones recibida");

  try {
    // Validar API Key
    const apiKey = req.get("x-api-key");

    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        ok: false,
        mensaje: "API Key inválida o no proporcionada"
      });
    }

    // Validar configuración
    const faltantes = validarConfiguracion();

    if (faltantes.length > 0) {
      return res.status(500).json({
        ok: false,
        mensaje: "Faltan variables de entorno",
        variables: faltantes
      });
    }

    // El JSON esperado es un arreglo de registros
    const registros = req.body;

    if (!Array.isArray(registros)) {
      return res.status(400).json({
        ok: false,
        mensaje: "El body debe ser un arreglo JSON"
      });
    }

    if (registros.length === 0) {
      return res.status(400).json({
        ok: false,
        mensaje: "El arreglo JSON no contiene registros"
      });
    }

    // Obtener nombre de archivo del encabezado
    const nombreArchivoOriginal =
      req.get("x-filename") || "asignaciones.json";

    const nombreArchivo = nombreArchivoOriginal
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .slice(0, 255);

    // Convertir el arreglo a texto JSON
    const contenidoJSON = JSON.stringify(registros);

    // Conectar a SQL Server
    const pool = await obtenerPool();

    console.log(
      `[SQL] Enviando ${registros.length} registros al procedimiento`
    );

    // Ejecutar procedimiento almacenado
    const resultado = await pool
      .request()
      .input(
        "NombreArchivo",
        sql.NVarChar(255),
        nombreArchivo
      )
      .input(
        "ContenidoJSON",
        sql.NVarChar(sql.MAX),
        contenidoJSON
      )
      .output(
        "Valido",
        sql.Bit
      )
      .output(
        "Mensaje",
        sql.NVarChar(1000)
      )
      .execute("dbo.GuardarAsignacionJSON");

    const valido = resultado.output.Valido;
    const mensaje = resultado.output.Mensaje;

    console.log("[SQL] Procedimiento ejecutado", {
      valido,
      mensaje
    });

    // Resultado de validación del procedimiento
    if (valido !== true && valido !== 1) {
      return res.status(422).json({
        ok: false,
        archivo: nombreArchivo,
        registrosRecibidos: registros.length,
        mensaje:
          mensaje || "SQL Server rechazó el contenido"
      });
    }

    // Operación exitosa
    return res.status(200).json({
      ok: true,
      archivo: nombreArchivo,
      registrosRecibidos: registros.length,
      mensaje:
        mensaje || "Archivo procesado correctamente"
    });

  } catch (error) {
    registrarError("[ERROR ASIGNACIONES]", error);

    return res.status(500).json({
      ok: false,
      mensaje: "Error al procesar las asignaciones",
      codigo: error.code || "INTERNAL_ERROR"
    });
  }
});

// Manejo de errores de JSON y otras solicitudes
app.use((error, req, res, next) => {
  if (
    error instanceof SyntaxError &&
    error.status === 400 &&
    "body" in error
  ) {
    return res.status(400).json({
      ok: false,
      mensaje: "El body contiene JSON inválido"
    });
  }

  if (res.headersSent) {
    return next(error);
  }

  console.error("[ERROR GENERAL]", error.message);

  return res.status(500).json({
    ok: false,
    mensaje: "Error interno del servidor"
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`API escuchando en el puerto ${PORT}`);
});



