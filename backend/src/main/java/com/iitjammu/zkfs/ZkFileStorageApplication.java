package com.iitjammu.zkfs;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Entry point for the Zero-Knowledge Encrypted File Storage backend.
 *
 * <p>Architecture overview:
 * <ul>
 *   <li>All file content is encrypted client-side (AES-256-GCM) before upload.</li>
 *   <li>Filenames and Data Encryption Keys (DEKs) are never visible to the server.</li>
 *   <li>The server stores only opaque ciphertext blobs and encrypted key material.</li>
 * </ul>
 */
@SpringBootApplication
@ConfigurationPropertiesScan("com.iitjammu.zkfs.config.properties")
public class ZkFileStorageApplication {

    public static void main(String[] args) {
        SpringApplication.run(ZkFileStorageApplication.class, args);
    }
}
