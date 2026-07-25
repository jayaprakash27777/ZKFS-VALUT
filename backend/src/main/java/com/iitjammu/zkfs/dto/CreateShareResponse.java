package com.iitjammu.zkfs.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Response for POST /v1/share
 * Contains only the share token and metadata — never crypto secrets.
 */
public record CreateShareResponse(

        @JsonProperty("shareToken")
        UUID shareToken,

        @JsonProperty("shareUrl")
        String shareUrl,

        @JsonProperty("expiresAt")
        OffsetDateTime expiresAt,

        @JsonProperty("maxDownloads")
        Integer maxDownloads,

        @JsonProperty("createdAt")
        OffsetDateTime createdAt

) {}
