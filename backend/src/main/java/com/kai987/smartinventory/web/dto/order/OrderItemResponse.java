package com.kai987.smartinventory.web.dto.order;

import com.fasterxml.jackson.annotation.JsonInclude;

public record OrderItemResponse(
        String productId,
        String productName,
        String unitPriceYen,
        double unitWeightKg,
        int quantity,
        String subtotalYen,
        double totalWeightKg,
        @JsonInclude(JsonInclude.Include.NON_NULL) String productNameJa,
        @JsonInclude(JsonInclude.Include.NON_NULL) String productNameZh) {
}
