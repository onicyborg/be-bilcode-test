import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, NotFoundException, OnApplicationShutdown, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Category, Prediction } from './dto';

@Injectable()
export class PhotoService implements OnApplicationShutdown {
  private readonly bucket = process.env.R2_BUCKET_NAME?.trim();
  private readonly client = this.configureStorage();

  private configureStorage() {
    const { R2_ACCOUNT_ID, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
    const endpoint = R2_ENDPOINT?.trim() || (R2_ACCOUNT_ID?.trim() && `https://${R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`);
    if (!this.bucket || !endpoint || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      Logger.warn('R2 is not configured. Photo operations will return 503.', 'PhotoService');
      return undefined;
    }
    return new S3Client({
      endpoint,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  onApplicationShutdown() {
    this.client?.destroy();
  }

  private storageUnavailable() {
    return new ServiceUnavailableException({ code: 'PHOTO_STORAGE_UNAVAILABLE', message: 'Photo storage is unavailable' });
  }

  async validate(file: Express.Multer.File) {
    try {
      const image = sharp(file.buffer, { limitInputPixels: 25_000_000, failOn: 'warning' });
      const { format } = await image.metadata();
      if (format !== 'jpeg' && format !== 'png') throw new Error('Invalid image format');
      return await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 }).toBuffer();
    } catch {
      throw new UnsupportedMediaTypeException({ code: 'INVALID_PHOTO', message: 'Upload a valid JPEG or PNG image' });
    }
  }

  async save(photo: Buffer) {
    if (!this.client) throw this.storageUnavailable();
    const key = randomUUID() + '.jpg';
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: key, Body: photo, ContentType: 'image/jpeg',
      }), { abortSignal: AbortSignal.timeout(10_000) });
      return key;
    } catch {
      Logger.error('R2 upload failed', 'PhotoService');
      throw this.storageUnavailable();
    }
  }

  async read(key: string) {
    if (!this.client) throw this.storageUnavailable();
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(10_000) });
      if (!object.Body) throw this.storageUnavailable();
      return Buffer.from(await object.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') throw new NotFoundException();
      Logger.error('R2 download failed', 'PhotoService');
      throw this.storageUnavailable();
    }
  }

  async remove(key: string) {
    if (!this.client) throw this.storageUnavailable();
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(10_000) });
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey') return;
      Logger.error('R2 deletion failed', 'PhotoService');
      throw this.storageUnavailable();
    }
  }

  async predict(photo: Buffer): Promise<Prediction | null> {
    const url = process.env.ML_URL;
    if (!url) return null;
    try {
      const form = new FormData();
      form.append('photo', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'report.jpg');
      const response = await fetch(url.replace(/\/$/, '') + '/predict', {
        method: 'POST', body: form, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const value = await response.json() as Partial<Prediction> | null;
      if (!value?.category || !Object.values(Category).includes(value.category) ||
          typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) ||
          value.confidence < 0 || value.confidence > 1 ||
          typeof value.modelVersion !== 'string' || !value.modelVersion.trim() || value.modelVersion.length > 100) return null;
      return { category: value.category, confidence: value.confidence, modelVersion: value.modelVersion };
    } catch {
      return null;
    }
  }
}
