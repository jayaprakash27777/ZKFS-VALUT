package com.iitjammu.zkfs.config.properties;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * Type-safe binding for the {@code minio.*} block in application.yml.
 *
 * <pre>
 * minio:
 *   endpoint:   http://localhost:9000
 *   access-key: minioadmin
 *   secret-key: minioadmin
 *   bucket:
 *     chunks: zk-chunks
 *     temp:   zk-temp
 *   region: us-east-1
 *   presigned-url-expiry: 3600
 * </pre>
 */
@ConfigurationProperties(prefix = "minio")
public record MinioProperties(
        String endpoint,
        String accessKey,
        String secretKey,
        BucketConfig bucket,
        String region,
        long presignedUrlExpiry
) {
    public record BucketConfig(String chunks, String temp) {}

    /** Returns all bucket names that must exist at startup. */
    public List<String> allBuckets() {
        return List.of(bucket.chunks(), bucket.temp());
    }
}
