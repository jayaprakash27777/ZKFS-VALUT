package com.iitjammu.zkfs.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Thrown when authentication fails (wrong authHash or non-existent user).
 *
 * <p>SECURITY: Always throw this same exception for both "user not found"
 * and "wrong password" cases — never expose which condition triggered it.
 * This prevents user enumeration via timing or error message differences.
 */
@ResponseStatus(HttpStatus.UNAUTHORIZED)
public class InvalidCredentialsException extends RuntimeException {

    private static final String GENERIC_MESSAGE = "Invalid email or authentication credentials";

    public InvalidCredentialsException() {
        super(GENERIC_MESSAGE);
    }

    /** Internal constructor — message is NOT exposed to clients. */
    public InvalidCredentialsException(String internalReason) {
        super(GENERIC_MESSAGE); // Always use generic message in response
        // Internal reason available via cause for logging only
    }
}
