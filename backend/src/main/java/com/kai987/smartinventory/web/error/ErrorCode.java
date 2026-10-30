package com.kai987.smartinventory.web.error;

import org.springframework.http.HttpStatus;

public enum ErrorCode {
    VALIDATION_ERROR(HttpStatus.BAD_REQUEST, "One or more fields are invalid."),
    IMAGE_TYPE(HttpStatus.BAD_REQUEST, "Use a valid PNG, JPEG, or WebP image."),
    IMAGE_SIZE(HttpStatus.PAYLOAD_TOO_LARGE, "Product images must not exceed 2 MiB."),
    IMAGE_EMPTY(HttpStatus.BAD_REQUEST, "Choose a non-empty product image."),
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "Invalid username or password."),
    UNAUTHENTICATED(HttpStatus.UNAUTHORIZED, "Authentication is required."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "You do not have permission to perform this action."),
    CSRF_INVALID(HttpStatus.FORBIDDEN, "The security token is missing or invalid."),
    USERNAME_EXISTS(HttpStatus.CONFLICT, "That username is already registered."),
    PRODUCT_EXISTS(HttpStatus.CONFLICT, "A product with that ID already exists."),
    PRODUCT_NOT_FOUND(HttpStatus.NOT_FOUND, "The requested product was not found."),
    EMPTY_ORDER(HttpStatus.BAD_REQUEST, "An order must contain at least one item."),
    INSUFFICIENT_STOCK(HttpStatus.CONFLICT, "One or more products do not have enough stock."),
    IDEMPOTENCY_CONFLICT(HttpStatus.CONFLICT, "This checkout key was already used for a different order."),
    PERSISTENCE_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "The data could not be saved safely."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "The requested resource was not found."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred.");

    private final HttpStatus status;
    private final String defaultMessage;

    ErrorCode(HttpStatus status, String defaultMessage) {
        this.status = status;
        this.defaultMessage = defaultMessage;
    }

    public HttpStatus status() { return status; }
    public String defaultMessage() { return defaultMessage; }
}
