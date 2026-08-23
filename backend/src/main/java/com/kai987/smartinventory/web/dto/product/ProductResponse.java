package com.kai987.smartinventory.web.dto.product;

public record ProductResponse(
        String id,
        String name,
        String priceYen,
        int stock,
        double weightKg,
        boolean available) {
}
