package com.kai987.smartinventory.web.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.kai987.smartinventory.domain.OrderManager;
import com.kai987.smartinventory.service.SmartInventoryService;
import com.kai987.smartinventory.web.dto.order.CreateOrderRequest;
import com.kai987.smartinventory.web.dto.order.OrderListResponse;
import com.kai987.smartinventory.web.dto.order.OrderResponse;
import com.kai987.smartinventory.web.mapper.ApiMapper;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final SmartInventoryService service;
    private final ApiMapper mapper;

    public OrderController(SmartInventoryService service, ApiMapper mapper) {
        this.service = service;
        this.mapper = mapper;
    }

    @PostMapping
    public ResponseEntity<OrderResponse> create(@Valid @RequestBody CreateOrderRequest request,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            Authentication authentication) {
        var requested = request.items().stream()
                .map(item -> new OrderManager.RequestedItem(item.productId(), item.quantity()))
                .toList();
        var order = service.createOrder(authentication.getName(), requested, idempotencyKey);
        return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toOrder(order));
    }

    @GetMapping("/me")
    public OrderListResponse mine(Authentication authentication) {
        var items = service.ordersForCustomer(authentication.getName()).stream()
                .map(mapper::toOrder).toList();
        return new OrderListResponse(items, items.size());
    }

    @GetMapping
    public OrderListResponse all(@RequestParam(required = false) String customer) {
        var items = service.allOrders(customer).stream().map(mapper::toOrder).toList();
        return new OrderListResponse(items, items.size());
    }
}
