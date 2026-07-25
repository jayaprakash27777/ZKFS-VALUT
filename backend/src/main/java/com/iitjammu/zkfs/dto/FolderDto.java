package com.iitjammu.zkfs.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;
import java.util.UUID;

public record FolderDto(
        @JsonProperty("id") UUID id,
        @JsonProperty("parentId") UUID parentId,
        @JsonProperty("nameEncrypted") String nameEncrypted,
        @JsonProperty("iv") String iv,
        @JsonProperty("createdAt") OffsetDateTime createdAt,
        @JsonProperty("updatedAt") OffsetDateTime updatedAt
) {
    public static FolderDto from(com.iitjammu.zkfs.domain.Folder entity) {
        return new FolderDto(
                entity.getId(),
                entity.getParent() != null ? entity.getParent().getId() : null,
                entity.getNameEncrypted(),
                entity.getIv(),
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }
}
