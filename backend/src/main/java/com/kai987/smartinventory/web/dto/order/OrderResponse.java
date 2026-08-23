package com.kai987.smartinventory.web.dto.order;

import java.util.List;

public record OrderResponse(
        String orderId,
        String customerName,
        List<OrderItemResponse> items,
        String totalPriceYen,
        double totalWeightKg,
        int estimatedBoxes) {
    public OrderResponse {
        items = List.copyOf(items);
    }
}
