import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Config {
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
  /**
   * Browser-reachable S3 origin used only for presigning (e.g. https://subspace.example).
   * The web proxy forwards /<bucket>/ to MinIO preserving Host, so signatures still verify.
   */
  publicEndpoint?: string;
}

export class SubspaceS3Storage {
  private client: S3Client;
  private signer: S3Client;
  public bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    const isLocalOrMinio =
      config.endpoint.includes('minio') ||
      config.endpoint.includes('localhost') ||
      config.endpoint.includes('127.0.0.1');

    const makeClient = (endpoint: string, forcePathStyle: boolean) =>
      new S3Client({
        endpoint: endpoint.startsWith('http') ? endpoint : `http://${endpoint}`,
        region: config.region || 'us-east-1',
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle,
      });

    this.client = makeClient(config.endpoint, config.forcePathStyle ?? isLocalOrMinio);
    this.signer = config.publicEndpoint ? makeClient(config.publicEndpoint, true) : this.client;
  }

  /**
   * Ensures the configured bucket exists; creates it if missing
   */
  async ensureBucketExists(bucket: string = this.bucket): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
          console.log(`[File Service] Provisioned MinIO bucket: ${bucket}`);
        } catch (createErr: any) {
          console.warn(`[File Service] Bucket creation warning:`, createErr.message);
        }
      }
    }
  }

  /**
   * Applies an anonymous, read-only bucket policy (GetObject only). Used for the
   * public-read `subspace-media` bucket so uploaded avatars/icons/glyphs are servable
   * without presigning.
   */
  async setPublicReadPolicy(bucket: string): Promise<void> {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucket}/*`],
        },
      ],
    };
    try {
      await this.client.send(
        new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) })
      );
    } catch (err: any) {
      console.warn(`[File Service] Bucket policy warning for ${bucket}:`, err.message);
    }
  }

  /**
   * Generate a presigned S3 PUT URL for direct client upload
   */
  async getPresignedUploadUrl(
    storageKey: string,
    contentType: string,
    expiresInSeconds = 900, // 15 minutes
    bucket: string = this.bucket,
    /** Signed into the URL: storage refuses a body of any other size. */
    contentLength?: number
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ContentType: contentType,
      ...(contentLength ? { ContentLength: contentLength } : {}),
    });
    return getSignedUrl(this.signer, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Generate a presigned S3 GET URL for direct client download / viewing
   */
  async getPresignedDownloadUrl(
    storageKey: string,
    expiresInSeconds = 3600, // 1 hour
    bucket: string = this.bucket,
    response?: { contentDisposition?: string; contentType?: string }
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      ResponseContentDisposition: response?.contentDisposition,
      ResponseContentType: response?.contentType,
    });
    return getSignedUrl(this.signer, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Store an object from the server side (cloud drive imports).
   */
  async putObject(storageKey: string, body: Buffer, contentType: string, bucket: string = this.bucket): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: storageKey, Body: body, ContentType: contentType }));
  }

  /**
   * Remove an object from storage
   */
  async deleteObject(storageKey: string, bucket: string = this.bucket): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      })
    );
  }

  /**
   * HEAD an object to verify it exists (after a client PUT) and read back its actual
   * size/content-type. Throws if the object is missing.
   */
  async headObject(
    storageKey: string,
    bucket: string = this.bucket
  ): Promise<{ sizeBytes: number; contentType: string | undefined }> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: storageKey }));
    return { sizeBytes: Number(result.ContentLength || 0), contentType: result.ContentType };
  }
}
