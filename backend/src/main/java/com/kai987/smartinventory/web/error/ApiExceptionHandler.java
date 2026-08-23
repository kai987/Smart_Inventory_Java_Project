package com.kai987.smartinventory.web.error;

import java.time.Instant;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import com.kai987.smartinventory.persistence.PersistenceException;
import com.kai987.smartinventory.web.dto.error.ApiErrorResponse;
import com.kai987.smartinventory.web.dto.error.FieldErrorResponse;

import jakarta.servlet.http.HttpServletRequest;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger LOGGER = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ApiErrorResponse> handleDomain(DomainException exception,
            HttpServletRequest request) {
        return response(exception.getErrorCode(), exception.getMessage(),
                exception.getFieldErrors(), request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException exception,
            HttpServletRequest request) {
        List<FieldErrorResponse> fields = exception.getBindingResult().getFieldErrors().stream()
                .map(this::toFieldError).toList();
        return response(ErrorCode.VALIDATION_ERROR, ErrorCode.VALIDATION_ERROR.defaultMessage(),
                fields, request);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleUnreadable(HttpMessageNotReadableException exception,
            HttpServletRequest request) {
        return response(ErrorCode.VALIDATION_ERROR, "The request body is invalid.", List.of(), request);
    }

    @ExceptionHandler({MethodArgumentTypeMismatchException.class,
            MissingServletRequestParameterException.class})
    public ResponseEntity<ApiErrorResponse> handleRequestParameter(Exception exception,
            HttpServletRequest request) {
        return response(ErrorCode.VALIDATION_ERROR, ErrorCode.VALIDATION_ERROR.defaultMessage(),
                List.of(), request);
    }

    @ExceptionHandler(PersistenceException.class)
    public ResponseEntity<ApiErrorResponse> handlePersistence(PersistenceException exception,
            HttpServletRequest request) {
        LOGGER.error("A persistence operation failed.", exception);
        return response(ErrorCode.PERSISTENCE_ERROR, ErrorCode.PERSISTENCE_ERROR.defaultMessage(),
                List.of(), request);
    }

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    public ResponseEntity<ApiErrorResponse> handleNotFound(Exception exception,
            HttpServletRequest request) {
        return response(ErrorCode.NOT_FOUND, ErrorCode.NOT_FOUND.defaultMessage(), List.of(), request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception exception,
            HttpServletRequest request) {
        LOGGER.error("An unexpected request failure occurred.", exception);
        return response(ErrorCode.INTERNAL_ERROR, ErrorCode.INTERNAL_ERROR.defaultMessage(),
                List.of(), request);
    }

    private FieldErrorResponse toFieldError(FieldError fieldError) {
        return new FieldErrorResponse(fieldError.getField(), fieldError.getDefaultMessage());
    }

    private ResponseEntity<ApiErrorResponse> response(ErrorCode code, String message,
            List<FieldErrorResponse> fieldErrors, HttpServletRequest request) {
        return ResponseEntity.status(code.status()).body(new ApiErrorResponse(Instant.now(),
                code.status().value(), code.name(), message, request.getRequestURI(), fieldErrors));
    }
}
