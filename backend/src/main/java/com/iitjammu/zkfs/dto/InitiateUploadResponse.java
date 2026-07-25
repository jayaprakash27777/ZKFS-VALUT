package com.iitjammu.zkfs.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Response for POST /api/v1/files/initiate
 * Contains the server-assigned fileId and initial upload state.
 */
public record InitiateUploadResponse(

        @JsonProperty("fileId")
        UUID fileId,

        @JsonProperty("status")
        String status,

        @JsonProperty("totalChunks")
        int totalChunks,

        @JsonProperty("createdAt")
        OffsetDateTime createdAt

) {}
