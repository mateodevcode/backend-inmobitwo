import {
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  AWS_ACCESS_KEY_ID,
  AWS_BUCKET,
  AWS_DEFAULT_REGION,
  AWS_SECRET_ACCESS_KEY,
} from "../config.js";

export const createS3Client = () => {
  const s3 = new S3Client({
    region: AWS_DEFAULT_REGION, // ejemplo: "us-east-2"
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
    // Forzar estilo virtual-hosted (recomendado por AWS)
    forcePathStyle: false,
  });

  return s3;
};

const s3 = createS3Client();
const bucketName = AWS_BUCKET;

// Convierte archivo a Buffer
export async function fileToBuffer(file) {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Subir a S3
export async function uploadToS3(buffer, key, contentType) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(command);

  // URL pública: estilo virtual-hosted
  return `https://${bucketName}.s3.${AWS_DEFAULT_REGION}.amazonaws.com/${key}`;
}

// Eliminar de S3
export async function deleteFromS3(key) {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  await s3.send(command);
}
