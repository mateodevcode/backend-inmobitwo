// src/lib/fieldSelection.helper.js
// Sparse Fieldsets: filtra qué columnas devolver según el query param ?fields=
//
// Uso:
//   const { columnas, error } = selectFields(req.query.fields, permitidos, defaults);
//   if (error) return res.status(400).json({ success: false, error });
//   const query = `SELECT ${columnas.join(", ")} FROM ...`;

export function selectFields(fieldsParam, permitidos, defaults) {
  if (!fieldsParam || !fieldsParam.trim()) {
    return { columnas: defaults, error: null };
  }

  const solicitados = fieldsParam
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);

  if (solicitados.length === 0) {
    return { columnas: defaults, error: null };
  }

  const invalidos = solicitados.filter((f) => !permitidos.includes(f));

  if (invalidos.length > 0) {
    return {
      columnas: [],
      error: `Campo(s) no permitido(s): ${invalidos.join(", ")}`,
    };
  }

  return { columnas: solicitados, error: null };
}
