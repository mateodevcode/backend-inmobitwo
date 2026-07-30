use aws_sdk_s3::Client;
use std::env;

pub struct AppState {
    pub s3_client: Client,
    pub bucket: String,
}

impl AppState {
    pub async fn new() -> Self {
        let config = aws_config::from_env()
            .region(aws_config::Region::new(
                env::var("AWS_DEFAULT_REGION").unwrap_or_else(|_| "us-east-1".to_string()),
            ))
            .load()
            .await;

        let s3_client = Client::new(&config);
        let bucket = env::var("AWS_BUCKET").expect("AWS_BUCKET must be set");

        AppState { s3_client, bucket }
    }
}
