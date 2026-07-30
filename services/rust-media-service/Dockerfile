FROM rust:1-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev pkgconfig openssl-dev ffmpeg
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM alpine:latest
RUN apk --no-cache add ca-certificates ffmpeg
WORKDIR /root/
COPY --from=builder /app/target/release/rust-media-service .
EXPOSE 3003
CMD ["./rust-media-service"]
