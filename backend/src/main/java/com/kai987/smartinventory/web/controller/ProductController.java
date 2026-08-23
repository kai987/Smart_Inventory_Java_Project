package com.kai987.smartinventory.web.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.kai987.smartinventory.domain.Product;
import com.kai987.smartinventory.service.SmartInventoryService;
import com.kai987.smartinventory.web.dto.product.CreateProductRequest;
import com.kai987.smartinventory.web.dto.product.ProductListResponse;
import com.kai987.smartinventory.web.dto.product.ProductResponse;
import com.kai987.smartinventory.web.dto.product.UpdateStockRequest;
import com.kai987.smartinventory.web.mapper.ApiMapper;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/products")
public class ProductController {
    private final SmartInventoryService service;
    private final ApiMapper mapper;

    public ProductController(SmartInventoryService service, ApiMapper mapper) {
        this.service = service;
        this.mapper = mapper;
    }

    @GetMapping
    public ProductListResponse products(@RequestParam(required = false) String q,
            @RequestParam(defaultValue = "false") boolean inStockOnly) {
        var items = service.listProducts(q, inStockOnly).stream().map(mapper::toProduct).toList();
        return new ProductListResponse(items, items.size());
    }

    @GetMapping("/{id}")
    public ProductResponse product(@PathVariable String id) {
        return mapper.toProduct(service.getProduct(id));
    }

    @PostMapping
    public ResponseEntity<ProductResponse> create(@Valid @RequestBody CreateProductRequest request) {
        Product product = service.addProduct(request.id(), request.name(), request.priceYen(),
                request.stock(), request.weightKg());
        return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toProduct(product));
    }

    @PatchMapping("/{id}/stock")
    public ProductResponse updateStock(@PathVariable String id,
            @Valid @RequestBody UpdateStockRequest request) {
        return mapper.toProduct(service.updateStock(id, request.stock()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        service.deleteProduct(id);
        return ResponseEntity.noContent().build();
    }
}
