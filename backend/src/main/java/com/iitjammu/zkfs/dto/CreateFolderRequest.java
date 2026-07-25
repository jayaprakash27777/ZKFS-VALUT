package com.iitjammu.zkfs.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record CreateFolderRequest(
        UUID parentId,

        @NotBlank(message = "nameEncrypted is required")
        String nameEncrypted,

        @NotBlank(message = "iv is required")
        @Size(min = 16, max = 24, message = "iv must be a Base64-encoded 12-byte IV")
        String iv
) {}
