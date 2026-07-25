package com.iitjammu.zkfs.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record UpdateRecoveryKeyRequest(
        @NotBlank(message = "recoveryWrappedKek is required")
        String recoveryWrappedKek,

        @NotBlank(message = "recoveryIv is required")
        @Pattern(regexp = "^[A-Za-z0-9+/]+={0,2}$", message = "recoveryIv must be valid Base64")
        String recoveryIv
) {}
