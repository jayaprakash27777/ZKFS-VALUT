package com.iitjammu.zkfs.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Full file metadata response — returned by list, get, and complete endpoints.
 *
 * <p>All sensitive fields ({@code filenameEncrypted}, {@code wrappedDek},
 * {@code ivWrappedDek}) are opaque blobs only the client can interpret.
 */
public record FileMetadataDto(

        @JsonProperty("id")
        UUID id,

        @JsonProperty("filenameEncrypted")
        String filenameEncrypted,

        @JsonProperty("mimeType")
        String mimeType,

        @JsonProperty("thumbnailEncrypted")
        String thumbnailEncrypted,

        @JsonProperty("totalChunks")
        int totalChunks,

        @JsonProperty("totalSize")
        long totalSize,

        @JsonProperty("wrappedDek")
        String wrappedDek,

        @JsonProperty("ivWrappedDek")
        String ivWrappedDek,

        @JsonProperty("uploadStatus")
        String uploadStatus,

        @JsonProperty("createdAt")
        OffsetDateTime createdAt,

        @JsonProperty("updatedAt")
        OffsetDateTime updatedAt,
        
        @JsonProperty("folderId")
        UUID folderId,

        @JsonProperty("isPasswordProtected")
        boolean isPasswordProtected,

        @JsonProperty("passwordSalt")
        String passwordSalt,

        @JsonProperty("isPasskeyProtected")
        boolean isPasskeyProtected,

        @JsonProperty("passkeySalt")
        String passkeySalt

) {
    /** Maps a {@link com.iitjammu.zkfs.domain.FileMetadata} entity to this DTO. */
    public static FileMetadataDto from(com.iitjammu.zkfs.domain.FileMetadata entity) {
        return new FileMetadataDto(
                entity.getId(),
                entity.getFilenameEncrypted(),
                entity.getMimeType(),
                entity.getThumbnailEncrypted(),
                entity.getTotalChunks(),
                entity.getTotalSize(),
                entity.getWrappedDek(),
                entity.getIvWrappedDek(),
                entity.getUploadStatus().name(),
                entity.getCreatedAt(),
                entity.getUpdatedAt(),
                entity.getFolder() != null ? entity.getFolder().getId() : null,
                entity.isPasswordProtected(),
                entity.getPasswordSalt(),
                entity.isPasskeyProtected(),
                entity.getPasskeySalt()
        );
    }
}
