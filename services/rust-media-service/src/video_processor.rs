use ffmpeg_sidecar::FfmpegProcess;
use std::path::Path;

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
    let output_path = output_dir.path();

    let master_playlist = format!("{}/master.m3u8", output_path.display());

    let mut ffmpeg = FfmpegProcess::new()
        .input(input_path.to_str().unwrap())
        .filter_complex(
            "[0:v]split=3[v1][v2][v3];[v1]scale=1920:1080[v1out];[v2]scale=1280:720[v2out];[v3]scale=854:480[v3out]",
        )
        .map("[v1out]")
        .codec_video("libx264")
        .bitrate_video("5000k")
        .map("[v2out]")
        .codec_video("libx264")
        .bitrate_video("2800k")
        .map("[v3out]")
        .codec_video("libx264")
        .bitrate_video("1400k")
        .map_audio("[0:a]")
        .codec_audio("aac")
        .bitrate_audio("128k")
        .output(master_playlist.clone())
        .format("hls")
        .hls_time(10)
        .hls_playlist_type("vod")
        .hls_segment_filename(format!("{}/segment_%v_%03d.ts", output_path.display()))
        .var_stream_map("v:0,a:0 v:1,a:1 v:2,a:2")
        .spawn()?;

    ffmpeg.wait()?;

    let thumbnail_path = format!("{}/thumbnail.jpg", output_path.display());
    let mut ffmpeg_thumb = FfmpegProcess::new()
        .input(input_path.to_str().unwrap())
        .seek("00:00:02")
        .frames(1)
        .output(&thumbnail_path)
        .spawn()?;

    ffmpeg_thumb.wait()?;

    Ok(VideoVersions {
        original: input_path.to_str().unwrap().to_string(),
        hls_master: master_playlist,
        hls_1080p: format!("{}/stream_0.m3u8", output_path.display()),
        hls_720p: format!("{}/stream_1.m3u8", output_path.display()),
        hls_480p: format!("{}/stream_2.m3u8", output_path.display()),
        thumbnail: thumbnail_path,
    })
}
