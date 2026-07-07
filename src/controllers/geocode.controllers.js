import { geocodeAddress } from "../lib/geocode.js";

export const getGeocode = async (req, res) => {
  const { address } = req.query;

  if (!address || address.trim().length < 5) {
    return res.status(400).json({
      success: false,
      message: "address es requerido (mínimo 5 caracteres)",
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
      error: error.message,
    });
  }
};
