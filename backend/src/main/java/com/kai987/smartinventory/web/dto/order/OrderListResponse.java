package com.kai987.smartinventory.web.dto.order;

import java.util.List;

public record OrderListResponse(List<OrderResponse> items, int total) {
    public OrderListResponse {
        items = List.copyOf(items);
    }
}
