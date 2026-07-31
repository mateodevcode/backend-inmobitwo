use image::{DynamicImage, GenericImageView};
use std::time::Instant;
use webp::Encoder;

pub struct ImageVersions {
    pub thumbnail: Vec<u8>,
    pub small: Vec<u8>,
    pub medium: Vec<u8>,
    pub large: Vec<u8>,
    pub xlarge: Vec<u8>,
}

pub async fn process_image(buffer: &[u8]) -> Result<ImageVersions, Box<dyn std::error::Error + Send + Sync>> {
    let total_start = Instant::now();

    let decode_start = Instant::now();
    let img = image::load_from_memory(buffer)?;
    tracing::info!(
        "⏱️ decode: {:?} ({}x{}px, {} bytes originales)",
        decode_start.elapsed(),
        img.width(),
        img.height(),
        buffer.len()
    );

    // Tamaños pensados para cubrir móvil, tablet y desktop (incluyendo pantallas @2x/retina).
    // Ninguno excede 2000px: es más que suficiente para cualquier pantalla real,
    // incluso en zoom a pantalla completa. Nada se guarda a resolución de cámara.
    let thumb_start = Instant::now();
    let thumbnail = resize_and_optimize(&img, 200, 70.0)?;
    tracing::info!("⏱️ resize+encode thumbnail (200px, q70): {:?}", thumb_start.elapsed());

    let small_start = Instant::now();
    let small = resize_and_optimize(&img, 480, 75.0)?;
    tracing::info!("⏱️ resize+encode small (480px, q75): {:?}", small_start.elapsed());

    let medium_start = Instant::now();
    let medium = resize_and_optimize(&img, 900, 80.0)?;
    tracing::info!("⏱️ resize+encode medium (900px, q80): {:?}", medium_start.elapsed());

    let large_start = Instant::now();
    let large = resize_and_optimize(&img, 1400, 85.0)?;
    tracing::info!("⏱️ resize+encode large (1400px, q85): {:?}", large_start.elapsed());

    let xlarge_start = Instant::now();
    let xlarge = resize_and_optimize(&img, 2000, 85.0)?;
    tracing::info!("⏱️ resize+encode xlarge (2000px, q85): {:?}", xlarge_start.elapsed());

    tracing::info!("⏱️ TOTAL procesamiento (CPU): {:?}", total_start.elapsed());

    Ok(ImageVersions {
        thumbnail,
        small,
        medium,
        large,
        xlarge,
    })
}

fn resize_and_optimize(
    img: &DynamicImage,
    max_dimension: u32,
    quality: f32,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let (width, height) = img.dimensions();

    let resized = if width > height && width > max_dimension {
        img.resize(max_dimension, u32::MAX, image::imageops::FilterType::Lanczos3)
    } else if height > max_dimension {
        img.resize(u32::MAX, max_dimension, image::imageops::FilterType::Lanczos3)
    } else {
        img.clone()
    };

    // Encoder real con pérdida (lossy) y calidad ajustable — a diferencia del
    // encoder built-in de `image`, que solo produce WebP lossless.
    let rgba = resized.to_rgba8();
    let encoder = Encoder::from_rgba(&rgba, rgba.width(), rgba.height());
    let encoded = encoder.encode(quality);

    Ok(encoded.to_vec())
}
