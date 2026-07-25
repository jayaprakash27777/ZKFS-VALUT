package com.iitjammu.zkfs.dto;

import jakarta.validation.constraints.NotBlank;

public record UpdateKeysRequest(
        @NotBlank(message = "publicKey is required")
        String publicKey,

        @NotBlank(message = "encPrivateKey is required")
        String encPrivateKey
) {}
