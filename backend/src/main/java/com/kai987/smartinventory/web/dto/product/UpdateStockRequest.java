package com.kai987.smartinventory.web.dto.product;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record UpdateStockRequest(@NotNull @Min(0) Integer stock) {
}
