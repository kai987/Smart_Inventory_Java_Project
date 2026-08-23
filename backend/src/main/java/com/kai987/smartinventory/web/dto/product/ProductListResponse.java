package com.kai987.smartinventory.web.dto.product;

import java.util.List;

public record ProductListResponse(List<ProductResponse> items, int total) {
    public ProductListResponse {
        items = List.copyOf(items);
    }
}
