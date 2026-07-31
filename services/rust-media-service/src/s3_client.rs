use aws_sdk_s3::Client;
use aws_sdk_s3::primitives::ByteStream;
use std::path::Path;
use std::time::Instant;

pub async fn upload_to_s3(
    client: &Client,
    data: &[u8],
    key: &str,
    content_type: &str,
    bucket: &str,
) -> String {
    let start = Instant::now();
    let size = data.len();
    let body = ByteStream::from(data.to_vec());
    let result = match client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(body)
        .content_type(content_type)
        .send()
        .await
    {
        Ok(_) => format!("{}/{}", get_bucket_url(bucket), key),
        Err(e) => {
            tracing::error!("Error uploading to S3: {}", e);
            String::new()
        }
    };
    tracing::info!("⏱️ S3 upload [{}] ({} bytes): {:?}", key, size, start.elapsed());
    result
}

pub async fn upload_file_to_s3(
    client: &Client,
    local_path: &str,
    key: &str,
    content_type: &str,
    bucket: &str,
) -> String {
    let start = Instant::now();
    let body = ByteStream::from_path(Path::new(local_path)).await;
    let result = match body {
        Ok(body) => match client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(body)
            .content_type(content_type)
            .send()
            .await
        {
            Ok(_) => format!("{}/{}", get_bucket_url(bucket), key),
            Err(e) => {
                tracing::error!("Error uploading file to S3: {}", e);
                String::new()
            }
        },
        Err(e) => {
            tracing::error!("Error reading file for S3 upload: {}", e);
            String::new()
        }
    };
    tracing::info!("⏱️ S3 upload archivo [{}]: {:?}", key, start.elapsed());
    result
}

fn get_bucket_url(bucket: &str) -> String {
    let region = std::env::var("AWS_DEFAULT_REGION").unwrap_or_else(|_| "us-east-1".to_string());
    format!("https://{}.s3.{}.amazonaws.com", bucket, region)
}
