use image::{DynamicImage, ImageFormat, GenericImageView};
use std::io::Cursor;

pub struct ImageVersions {
    pub original: Vec<u8>,
    pub large: Vec<u8>,
    pub medium: Vec<u8>,
    pub small: Vec<u8>,
    pub thumbnail: Vec<u8>,
}

pub async fn process_image(buffer: &[u8]) -> Result<ImageVersions, Box<dyn std::error::Error>> {
    let img = image::load_from_memory(buffer)?;

    let mut original_bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut original_bytes), ImageFormat::WebP)?;

    let large = resize_and_optimize(&img, 1200, 85)?;
    let medium = resize_and_optimize(&img, 800, 80)?;
    let small = resize_and_optimize(&img, 400, 75)?;
    let thumbnail = resize_and_optimize(&img, 200, 70)?;

    Ok(ImageVersions {
        original: original_bytes,
        large,
        medium,
        small,
        thumbnail,
    })
}

fn resize_and_optimize(
    img: &DynamicImage,
    max_dimension: u32,
    _quality: u8,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let (width, height) = img.dimensions();

    let resized = if width > height && width > max_dimension {
        img.resize(
            max_dimension,
            u32::MAX,
            image::imageops::FilterType::Lanczos3,
        )
    } else if height > max_dimension {
        img.resize(
            u32::MAX,
            max_dimension,
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        img.clone()
    };

    let mut bytes = Vec::new();
    resized.write_to(&mut Cursor::new(&mut bytes), ImageFormat::WebP)?;

    Ok(bytes)
}
