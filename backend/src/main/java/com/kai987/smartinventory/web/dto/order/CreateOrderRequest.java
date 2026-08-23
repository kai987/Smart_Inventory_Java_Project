package com.kai987.smartinventory.web.dto.order;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;

public record CreateOrderRequest(@NotEmpty List<@Valid CreateOrderItemRequest> items) {
    public CreateOrderRequest {
        items = items == null ? null : List.copyOf(items);
    }
}
