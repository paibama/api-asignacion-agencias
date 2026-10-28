  
const express = require("express");
const sql = require("mssql");

const app = express();
const PORT = process.env.PORT || 3000;

// Permite recibir archivos JSON grandes.
app.use(express.json({ limit: "20mb" }));

// Configuración de SQL Server mediante variables de entorno de Render.
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
    trustServerCertificate: process.env.DB_TRUST_CERT === "true",
    enableArithAbort: true
  }
};

// Pool de conexiones reutilizable.
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

// Verifica que existan las variables esenciales.
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

// Ruta de estado de la API.
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    servicio: "API de asignaciones",
    estado: "activo"
  });
});

// Ruta para comprobar conexión con SQL Server.
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
    await pool.request().query("SELECT 1 AS conectado");

    return res.status(200).json({
      ok: true,
      mensaje: "Conexión a SQL Server correcta"
    });
  } catch (error) {
    console.error("[HEALTH DB]", error.message);

    return res.status(500).json({
      ok: false,
      mensaje: "Sin conexión a SQL Server",
      codigo: error.code || "DB_ERROR"
    });
  }
});

// Recibe el JSON y lo entrega al procedimiento almacenado.
app.post("/api/v1/asignaciones", async (req, res) => {
  console.log("[POST] Solicitud de asignaciones recibida");

  try {
    // Autenticación por API Key.
    const apiKey = req.get("x-api-key");

    if (!apiKey || apiKey !== process.env.API_KEY) {
      return res.status(401).json({
        ok: false,
        mensaje: "API Key inválida o no proporcionada"
      });
    }

    // Comprueba las variables de configuración.
    const faltantes = validarConfiguracion();

    if (faltantes.length > 0) {
      return res.status(500).json({
        ok: false,
        mensaje: "Faltan variables de entorno",
        variables: faltantes
      });
    }

    // El archivo del cliente debe contener un arreglo JSON.
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

    // Nombre recibido en el encabezado x-filename.
    const nombreArchivoOriginal =
      req.get("x-filename") || "asignaciones.json";

    // Evita caracteres de ruta y limita el tamaño del nombre.
    const nombreArchivo = nombreArchivoOriginal
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .slice(0, 255);

    // Serializa el arreglo recibido para enviarlo a SQL Server.
    const contenidoJSON = JSON.stringify(registros);

    const pool = await obtenerPool();

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

    console.log("[SQL] Procedimiento almacenado ejecutado");

    // El procedimiento indica que el contenido no fue aceptado.
    if (valido !== true && valido !== 1) {
      return res.status(422).json({
        ok: false,
        archivo: nombreArchivo,
        registrosRecibidos: registros.length,
        mensaje: mensaje || "SQL Server rechazó el contenido"
      });
    }

    // Respuesta exitosa.
    return res.status(200).json({
      ok: true,
      archivo: nombreArchivo,
      registrosRecibidos: registros.length,
      mensaje: mensaje || "Archivo procesado correctamente"
    });

  } catch (error) {
    console.error("[ERROR ASIGNACIONES]", error.message);

    return res.status(500).json({
      ok: false,
      mensaje: "Error al procesar las asignaciones",
      codigo: error.code || "INTERNAL_ERROR"
    });
  }
});

// Manejo de JSON mal formado.
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

  console.error("[ERROR GENERAL]", error.message);

  return res.status(500).json({
    ok: false,
    mensaje: "Error interno del servidor"
  });
});

// Inicio del servicio.
app.listen(PORT, () => {
  console.log(`API escuchando en el puerto ${PORT}`);
});
