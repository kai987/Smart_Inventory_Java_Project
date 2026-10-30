package com.kai987.smartinventory.web.dto.product;

import com.fasterxml.jackson.annotation.JsonInclude;

public record ProductResponse(
        String id,
        String name,
        String priceYen,
        int stock,
        double weightKg,
        boolean available,
        @JsonInclude(JsonInclude.Include.NON_NULL) String nameJa,
        @JsonInclude(JsonInclude.Include.NON_NULL) String nameZh,
        @JsonInclude(JsonInclude.Include.NON_NULL) String category,
        @JsonInclude(JsonInclude.Include.NON_NULL) String imageUrl) {
}
