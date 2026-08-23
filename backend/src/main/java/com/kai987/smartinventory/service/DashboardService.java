package com.kai987.smartinventory.service;

import java.math.BigInteger;

import org.springframework.stereotype.Service;

import com.kai987.smartinventory.config.AppProperties;
import com.kai987.smartinventory.domain.Role;
import com.kai987.smartinventory.web.dto.admin.AdminSummaryResponse;

@Service
public class DashboardService {
    private final SmartInventoryService inventoryService;
    private final AppProperties properties;

    public DashboardService(SmartInventoryService inventoryService, AppProperties properties) {
        this.inventoryService = inventoryService;
        this.properties = properties;
    }

    public AdminSummaryResponse summary() {
        SmartInventoryService.StateSnapshot state = inventoryService.snapshot();
        long totalStock = state.products().stream().mapToLong(product -> product.getStock()).sum();
        long customers = state.users().stream().filter(user -> user.getRole() == Role.CUSTOMER).count();
        long lowStock = state.products().stream()
                .filter(product -> product.getStock() <= properties.getLowStockThreshold()).count();
        BigInteger value = state.products().stream()
                .map(product -> BigInteger.valueOf(product.getPriceYen())
                        .multiply(BigInteger.valueOf(product.getStock())))
                .reduce(BigInteger.ZERO, BigInteger::add);
        return new AdminSummaryResponse(state.products().size(), totalStock, state.orders().size(),
                Math.toIntExact(customers), Math.toIntExact(lowStock), properties.getLowStockThreshold(), value.toString());
    }
}
