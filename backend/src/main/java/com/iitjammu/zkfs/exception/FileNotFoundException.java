package com.iitjammu.zkfs.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

import java.util.UUID;

/**
 * Thrown when a file or chunk is not found, or the authenticated user
 * does not own the requested resource.
 *
 * <p>SECURITY: Both "not found" and "unauthorized access" conditions
 * return 404 — revealing "forbidden" (403) would confirm the resource exists.
 */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class FileNotFoundException extends RuntimeException {

    public FileNotFoundException(UUID fileId) {
        super("File not found: " + fileId);
    }

    public FileNotFoundException(String message) {
        super(message);
    }
}
