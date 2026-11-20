# Versión fija: rust:1-alpine pasó a 1.100 (17/11/2026) y sqlx 0.7.4 deja de
# compilar (cambio en la inferencia del tipo `!`, rust-lang/rust#148922).
# Para subirla, actualizar antes sqlx a 0.8.
FROM rust:1.99-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev pkgconfig openssl-dev ffmpeg
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release
FROM alpine:latest
RUN apk --no-cache add ca-certificates ffmpeg
WORKDIR /root/
COPY --from=builder /app/target/release/rust-media-service .
EXPOSE 3003
CMD ["./rust-media-service"]
