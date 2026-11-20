# Versión fija: rust:1-alpine pasó a 1.100 (17/11/2026) y sqlx 0.7.4 deja de
# compilar (cambio en la inferencia del tipo `!`, rust-lang/rust#148922).
# Para subirla, actualizar antes sqlx a 0.8.
FROM rust:1.99-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src
COPY src ./src
COPY bot_listas ./bot_listas
RUN touch src/main.rs && cargo build --release
FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/target/release/rust-tracking-service .
COPY --from=builder /app/bot_listas ./bot_listas
EXPOSE 3002
CMD ["./rust-tracking-service"]
