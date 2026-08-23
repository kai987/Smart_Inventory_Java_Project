package com.kai987.smartinventory.web.error;

import java.util.List;

import com.kai987.smartinventory.web.dto.error.FieldErrorResponse;

public class DomainException extends RuntimeException {
    private final ErrorCode errorCode;
    private final List<FieldErrorResponse> fieldErrors;

    public DomainException(ErrorCode errorCode) {
        this(errorCode, errorCode.defaultMessage(), List.of());
    }

    public DomainException(ErrorCode errorCode, String message) {
        this(errorCode, message, List.of());
    }

    public DomainException(ErrorCode errorCode, String message,
            List<FieldErrorResponse> fieldErrors) {
        super(message);
        this.errorCode = errorCode;
        this.fieldErrors = List.copyOf(fieldErrors);
    }

    public ErrorCode getErrorCode() { return errorCode; }
    public List<FieldErrorResponse> getFieldErrors() { return fieldErrors; }
}
