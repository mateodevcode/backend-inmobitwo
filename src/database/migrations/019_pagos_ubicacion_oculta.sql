-- 019_pagos_ubicacion_oculta.sql
-- Pago único (Mercado Pago Colombia, COP) que activa "ocultar la ubicación
-- exacta en el mapa" de un anuncio. Idempotente: se puede reaplicar.
-- Responde a: propiedades.ubicacion_oculta + tabla pagos.
-- NOTA: propiedad_id en pagos es NULLable con ON DELETE SET NULL (si se borra
-- el anuncio, el pago queda marcado requiere_reembolso). El índice único
-- parcial de "un pago en curso" solo aplica mientras propiedad_id NO sea NULL.

-- ============================================================================
-- 1. COLUMNAAS DE UBICACIÓN OCULTA EN propiedades
-- ============================================================================
ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS ubicacion_oculta BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS ubicacion_oculta_at TIMESTAMPTZ;
ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS ubicacion_oculta_solicitada BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS latitude_publica DECIMAL(10, 8);
ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS longitude_publica DECIMAL(11, 8);
ALTER TABLE propiedades
  ADD COLUMN IF NOT EXISTS geom_publica GEOMETRY(Point, 4326);

CREATE INDEX IF NOT EXISTS idx_propiedades_geom_publica
  ON propiedades USING GIST (geom_publica);
CREATE INDEX IF NOT EXISTS idx_propiedades_ubicacion_oculta
  ON propiedades (ubicacion_oculta)
  WHERE ubicacion_oculta = TRUE;

-- ============================================================================
-- 2. TABLA pagos
-- ============================================================================
CREATE TABLE IF NOT EXISTS pagos (
    id BIGSERIAL PRIMARY KEY,
    -- Tipo de pago (por ahora solo 'ubicacion_oculta'; futuro: destacados, etc.)
    tipo VARCHAR(50) NOT NULL
        CHECK (tipo IN ('ubicacion_oculta')),
    -- Quién pagó (copia; el pago sobrevive al borrado del anuncio)
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    -- Anuncio al que aplica el pago
    propiedad_id INTEGER REFERENCES propiedades(id) ON DELETE SET NULL,
    -- Monto entero en moneda colombiana (COP, sin decimales)
    monto INTEGER NOT NULL CHECK (monto > 0),
    moneda VARCHAR(3) NOT NULL DEFAULT 'COP',
    -- Referencia única externa: la genera el backend al iniciar el pago;
    -- permite reconciliar el webhook con la fila local.
    external_reference VARCHAR(64) NOT NULL,
    -- Id del pago en Mercado Pago (llega al confirmar; UNIQUE para idempotencia)
    mp_payment_id BIGINT UNIQUE,
    -- Ciclo de vida: iniciado -> pending/in_process -> approved/rejected/cancelled
    estado VARCHAR(30) NOT NULL DEFAULT 'iniciado'
        CHECK (estado IN ('iniciado', 'pending', 'in_process', 'approved', 'rejected', 'cancelled')),
    estado_detalle VARCHAR(255),
    -- Las columnas *_at NO se tocan desde el cliente: solo el backend,
    -- tras verificar el pago contra la API de Mercado Pago.
    verificado_at TIMESTAMPTZ,   -- aprobado y validado (monto/moneda/referencia)
    aplicado_at TIMESTAMPTZ,     -- ubicación oculta activada
    -- Pago aprobado que no se pudo aplicar (propiedad borrada / duplicado):
    -- queda marcado para revisión manual de reembolso.
    requiere_reembolso BOOLEAN NOT NULL DEFAULT FALSE,
    -- Resumen mínimo sin datos sensibles (payment_method_id, etc.)
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_usuario ON pagos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pagos_propiedad ON pagos(propiedad_id);
CREATE INDEX IF NOT EXISTS idx_pagos_estado_pendientes
  ON pagos (estado, created_at)
  WHERE estado IN ('pending', 'in_process', 'iniciado');

-- UN solo pago "en curso" por propiedad y tipo: dos pestañas o doble clic no
-- generan dos cobros. Estados en curso: iniciado, pending, in_process, y
-- approved que aún no se aplicó (ventana entre verificado y aplicado).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_un_pago_en_curso
  ON pagos (propiedad_id, tipo)
  WHERE propiedad_id IS NOT NULL
    AND (
      estado IN ('iniciado', 'pending', 'in_process')
      OR (estado = 'approved' AND aplicado_at IS NULL)
    );

-- ----------------------------------------------------------------------------
-- Actualizado de updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION f_pagos_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_pagos_updated_at ON pagos;
CREATE TRIGGER tg_pagos_updated_at
  BEFORE UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION f_pagos_touch_updated_at();
