export function errorHandler(err, req, res, next) {
  console.error("❌ Error:", err.stack || err.message || err);

  const status = err.status || err.statusCode || 500;
  const message =
    status === 500 ? "Error interno del servidor" : err.message || "Error";

  if (status === 500) {
    console.error("❌ Error 500:", err);
  }

  res.status(status).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== "production" && { details: err.message }),
  });
}
