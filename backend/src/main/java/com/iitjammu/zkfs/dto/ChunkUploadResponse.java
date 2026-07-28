package com.iitjammu.zkfs.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/** Response for POST /api/v1/files/{fileId}/chunk/{chunkIndex} */
public record ChunkUploadResponse(

        @JsonProperty("chunkId")
        UUID chunkId,

        @JsonProperty("fileId")
        UUID fileId,

        @JsonProperty("chunkIndex")
        int chunkIndex,

        @JsonProperty("chunkSize")
        long chunkSize
) {}
