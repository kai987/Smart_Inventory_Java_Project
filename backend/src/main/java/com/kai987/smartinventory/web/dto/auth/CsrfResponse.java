package com.kai987.smartinventory.web.dto.auth;

public record CsrfResponse(String token, String headerName, String parameterName) {
}
