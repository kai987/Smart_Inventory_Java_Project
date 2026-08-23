package com.kai987.smartinventory.web.dto.order;

public record OrderItemResponse(
        String productId,
        String productName,
        String unitPriceYen,
        double unitWeightKg,
        int quantity,
        String subtotalYen,
        double totalWeightKg) {
}
