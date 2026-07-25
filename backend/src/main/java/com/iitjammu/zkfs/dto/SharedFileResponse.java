package com.iitjammu.zkfs.dto;

import java.time.OffsetDateTime;
import java.util.UUID;

public record SharedFileResponse(
        UUID id,
        String filenameEncrypted,
        String wrappedDek,
        String ivWrappedDek,
        long totalSize,
        String mimeType,
        UUID ownerId,
        String ownerEmail,
        OffsetDateTime sharedAt
) {}
