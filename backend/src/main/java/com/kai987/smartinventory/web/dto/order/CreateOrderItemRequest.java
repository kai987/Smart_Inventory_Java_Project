package com.kai987.smartinventory.web.dto.order;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record CreateOrderItemRequest(
        @NotBlank @Pattern(regexp = "P\\d{3}") String productId,
        @Min(1) int quantity) {
}
