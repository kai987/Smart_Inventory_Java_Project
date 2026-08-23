package com.kai987.smartinventory.web.dto.product;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateProductRequest(
        @NotBlank @Pattern(regexp = "P\\d{3}") String id,
        @NotBlank @Size(max = 100)
        @Pattern(regexp = "^[^,|:\\r\\n]+$", message = "Name contains a reserved character.")
        String name,
        @NotBlank @Pattern(regexp = "[1-9]\\d*", message = "Price must be a positive integer.")
        String priceYen,
        @NotNull @Min(0) Integer stock,
        @NotNull @DecimalMin(value = "0.0", inclusive = false) Double weightKg) {
}
