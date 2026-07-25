package com.iitjammu.zkfs.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Thrown when POST /complete is called before all expected chunks have been uploaded.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class UploadIncompleteException extends RuntimeException {

    public UploadIncompleteException(int expected, long actual) {
        super("Upload incomplete: expected %d chunks but found %d".formatted(expected, actual));
    }
}
