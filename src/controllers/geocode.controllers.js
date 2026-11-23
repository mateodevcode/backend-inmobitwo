import { geocodeAddress } from "../lib/geocode.js";

export const getGeocode = async (req, res) => {
  const { address } = req.query;

  if (typeof address !== "string" || address.trim().length < 5 || address.length > 200) {
    return res.status(400).json({
      success: false,
      message: "address es requerido (entre 5 y 200 caracteres)",
      data: null,
      error: null,
    });
  }

  try {
    const result = await geocodeAddress(address);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "No se encontró la dirección",
        data: null,
        error: null,
      });
    }

    res.json({ success: true, message: null, data: result, error: null });
  } catch (error) {
    console.error("Error geocodificando:", error);
    res.status(502).json({
      success: false,
      message: "Error al consultar el servicio de geocodificación",
      data: null,
      error: null,
    });
  }
};
