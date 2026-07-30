use std::path::Path;
use std::process::Command;

pub struct VideoVersions {
    pub original: String,
    pub hls_master: String,
    pub hls_1080p: String,
    pub hls_720p: String,
    pub hls_480p: String,
    pub thumbnail: String,
}

pub async fn process_video(input_path: &Path) -> Result<VideoVersions, Box<dyn std::error::Error>> {
    let output_dir = tempfile::tempdir()?;
    // into_path() evita que el directorio se borre solo al salir de la función
    let output_path = output_dir.into_path();

    let master_playlist = format!("{}/master.m3u8", output_path.display());
    let segment_pattern = format!("{}/segment_%v_%03d.ts", output_path.display());
    let input_str = input_path.to_str().ok_or("Ruta de entrada invalida")?;

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-i", input_str,
            "-filter_complex",
            "[0:v]split=3[v1][v2][v3];[v1]scale=1920:1080[v1out];[v2]scale=1280:720[v2out];[v3]scale=854:480[v3out]",
            "-map", "[v1out]", "-c:v:0", "libx264", "-b:v:0", "5000k",
            "-map", "[v2out]", "-c:v:1", "libx264", "-b:v:1", "2800k",
            "-map", "[v3out]", "-c:v:2", "libx264", "-b:v:2", "1400k",
            "-map", "a:0", "-map", "a:0", "-map", "a:0", "-c:a", "aac", "-b:a", "128k",
            "-f", "hls",
            "-hls_time", "10",
            "-hls_playlist_type", "vod",
            "-hls_segment_filename", &segment_pattern,
            "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2",
            &master_playlist,
        ])
        .status()?;

    if !status.success() {
        return Err("ffmpeg fallo al generar los streams HLS".into());
    }

    let thumbnail_path = format!("{}/thumbnail.jpg", output_path.display());
    let status_thumb = Command::new("ffmpeg")
        .args(["-y", "-i", input_str, "-ss", "00:00:02", "-frames:v", "1", &thumbnail_path])
        .status()?;

    if !status_thumb.success() {
        return Err("ffmpeg fallo al generar el thumbnail".into());
    }

    Ok(VideoVersions {
        original: input_str.to_string(),
        hls_master: master_playlist,
        hls_1080p: format!("{}/stream_0.m3u8", output_path.display()),
        hls_720p: format!("{}/stream_1.m3u8", output_path.display()),
        hls_480p: format!("{}/stream_2.m3u8", output_path.display()),
        thumbnail: thumbnail_path,
    })
}
