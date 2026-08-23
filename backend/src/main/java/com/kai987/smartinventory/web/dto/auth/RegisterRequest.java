package com.kai987.smartinventory.web.dto.auth;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@JsonIgnoreProperties(ignoreUnknown = true)
public record RegisterRequest(
        @NotBlank
        @Pattern(regexp = "[A-Za-z0-9_]{3,20}", message = "Use 3-20 letters, numbers, or underscores.")
        String username,
        @NotBlank
        @Size(min = 4, max = 100)
        @Pattern(regexp = "^[^,|:\\r\\n]+$", message = "Password contains a reserved character.")
        String password) {
}
