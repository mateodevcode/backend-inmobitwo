FROM rust:1.75-alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/target/release/rust-tracking-service .
EXPOSE 3002
CMD ["./rust-tracking-service"]
