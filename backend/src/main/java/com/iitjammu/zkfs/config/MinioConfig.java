package com.iitjammu.zkfs.config;

import com.iitjammu.zkfs.config.properties.MinioProperties;
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.SetBucketVersioningArgs;
import io.minio.messages.VersioningConfiguration;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;

/**
 * MinIO Configuration.
 *
 * <p>Responsibilities:
 * <ol>
 *   <li>Creates and exposes a configured {@link MinioClient} bean.</li>
 *   <li>On application startup ({@link ContextRefreshedEvent}), ensures that
 *       all required buckets exist (idempotent — safe to run multiple times).</li>
 *   <li>Enables versioning on the chunks bucket for durability.</li>
 * </ol>
 *
 * <p>All bucket names are externalized in {@code application.yml} via
 * {@link MinioProperties} — no hard-coded strings here.
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class MinioConfig {

    private final MinioProperties minioProperties;

    // ── Bean Definition ───────────────────────────────────────────────────────

    /**
     * Provides a fully configured {@link MinioClient} singleton.
     * Credentials and endpoint are injected from {@link MinioProperties}.
     */
    @Bean
    public MinioClient minioClient() {
        log.info("Initializing MinioClient → endpoint={}", minioProperties.endpoint());
        return MinioClient.builder()
                .endpoint(minioProperties.endpoint())
                .credentials(minioProperties.accessKey(), minioProperties.secretKey())
                .build();
    }

    // ── Startup Bucket Provisioning ───────────────────────────────────────────

    /**
     * Ensures all configured MinIO buckets exist when the Spring context is
     * fully loaded.  This listener is idempotent: if a bucket already exists,
     * it is not recreated.
     *
     * @param event fired when the application context is refreshed/started
     */
    @EventListener(ContextRefreshedEvent.class)
    public void provisionBuckets(ContextRefreshedEvent event) {
        // Guard: only run once (context may be refreshed multiple times in tests)
        if (event.getApplicationContext().getParent() != null) {
            return;
        }

        MinioClient client = event.getApplicationContext().getBean(MinioClient.class);

        for (String bucketName : minioProperties.allBuckets()) {
            ensureBucketExists(client, bucketName);
        }

        // Enable versioning on the chunks bucket for data durability
        enableVersioning(client, minioProperties.bucket().chunks());
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    private void ensureBucketExists(MinioClient client, String bucketName) {
        try {
            boolean exists = client.bucketExists(
                    BucketExistsArgs.builder().bucket(bucketName).build()
            );

            if (!exists) {
                client.makeBucket(
                        MakeBucketArgs.builder()
                                .bucket(bucketName)
                                .region(minioProperties.region())
                                .build()
                );
                log.info("MinIO bucket created: '{}'", bucketName);
            } else {
                log.debug("MinIO bucket already exists: '{}'", bucketName);
            }

        } catch (Exception ex) {
            // Fail fast — application cannot function without object storage
            throw new IllegalStateException(
                    "Failed to provision MinIO bucket '%s': %s".formatted(bucketName, ex.getMessage()),
                    ex
            );
        }
    }

    private void enableVersioning(MinioClient client, String bucketName) {
        try {
            client.setBucketVersioning(
                    SetBucketVersioningArgs.builder()
                            .bucket(bucketName)
                            .config(new VersioningConfiguration(
                                    VersioningConfiguration.Status.ENABLED, false
                            ))
                            .build()
            );
            log.info("Versioning enabled on MinIO bucket: '{}'", bucketName);
        } catch (Exception ex) {
            // Non-fatal: log a warning but continue startup
            log.warn("Could not enable versioning on bucket '{}': {}", bucketName, ex.getMessage());
        }
    }
}
