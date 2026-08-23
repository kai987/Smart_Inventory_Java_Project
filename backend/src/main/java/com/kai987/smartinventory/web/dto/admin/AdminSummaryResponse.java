package com.kai987.smartinventory.web.dto.admin;

public record AdminSummaryResponse(
        int productCount,
        long totalStock,
        int orderCount,
        int customerCount,
        int lowStockCount,
        int lowStockThreshold,
        String inventoryValueYen) {
}
