import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Config {
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
}

export class SubspaceS3Storage {
  private client: S3Client;
  public bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    const isLocalOrMinio =
      config.endpoint.includes('minio') ||
      config.endpoint.includes('localhost') ||
      config.endpoint.includes('127.0.0.1');

    this.client = new S3Client({
      endpoint: config.endpoint.startsWith('http')
        ? config.endpoint
        : `http://${config.endpoint}`,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? isLocalOrMinio,
    });
  }

  /**
   * Ensures the configured bucket exists; creates it if missing
   */
  async ensureBucketExists(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
          console.log(`[File Service] Provisioned MinIO bucket: ${this.bucket}`);
        } catch (createErr: any) {
          console.warn(`[File Service] Bucket creation warning:`, createErr.message);
        }
      }
    }
  }

  /**
   * Generate a presigned S3 PUT URL for direct client upload
   */
  async getPresignedUploadUrl(
    storageKey: string,
    contentType: string,
    expiresInSeconds = 900 // 15 minutes
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Generate a presigned S3 GET URL for direct client download / viewing
   */
  async getPresignedDownloadUrl(
    storageKey: string,
    expiresInSeconds = 3600 // 1 hour
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Remove an object from storage
   */
  async deleteObject(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      })
    );
  }
}
