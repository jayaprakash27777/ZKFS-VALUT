package com.iitjammu.zkfs.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;

/**
 * Standardized error response body for all API errors.
 * Returned by {@link com.iitjammu.zkfs.exception.GlobalExceptionHandler}.
 */
public record ErrorResponse(

        @JsonProperty("status")
        int status,

        @JsonProperty("error")
        String error,

        @JsonProperty("message")
        String message,

        @JsonProperty("path")
        String path,

        @JsonProperty("timestamp")
        OffsetDateTime timestamp

) {
    public static ErrorResponse of(int status, String error, String message, String path) {
        return new ErrorResponse(status, error, message, path, OffsetDateTime.now());
    }
}
