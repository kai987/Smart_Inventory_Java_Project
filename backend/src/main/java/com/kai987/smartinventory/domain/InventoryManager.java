package com.kai987.smartinventory.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class InventoryManager {
    private List<Product> products = new ArrayList<>();
    private final Map<String, Product> productMap = new LinkedHashMap<>();

    public List<Product> getProducts() {
        return products.stream().map(Product::copy).toList();
    }

    public void setProducts(List<Product> products) {
        if (products == null) {
            throw new IllegalArgumentException("Products cannot be null.");
        }
        List<Product> replacement = new ArrayList<>();
        Map<String, Product> index = new LinkedHashMap<>();
        for (Product product : products) {
            if (product == null || index.putIfAbsent(product.getId(), product.copy()) != null) {
                throw new IllegalArgumentException("Products contain null or duplicate IDs.");
            }
            replacement.add(index.get(product.getId()));
        }
        this.products = replacement;
        productMap.clear();
        productMap.putAll(index);
    }

    public boolean addProduct(Product product) {
        if (product == null || productMap.containsKey(product.getId())) {
            return false;
        }
        Product stored = product.copy();
        products.add(stored);
        productMap.put(stored.getId(), stored);
        return true;
    }

    public Product findProductById(String id) {
        Product product = productMap.get(id);
        return product == null ? null : product.copy();
    }

    Product findMutableProductById(String id) {
        return productMap.get(id);
    }

    public boolean updateStock(String id, int stock) {
        Product product = productMap.get(id);
        if (product == null || stock < 0) {
            return false;
        }
        product.setStock(stock);
        return true;
    }

    public boolean removeProduct(String id) {
        Product product = productMap.remove(id);
        return product != null && products.remove(product);
    }

    public List<Product> search(String keyword) {
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return products.stream()
                .filter(product -> product.getId().toLowerCase(Locale.ROOT).contains(normalized)
                        || product.getName().toLowerCase(Locale.ROOT).contains(normalized))
                .map(Product::copy)
                .toList();
    }

    public Map<String, Integer> snapshotStocks() {
        Map<String, Integer> result = new LinkedHashMap<>();
        products.forEach(product -> result.put(product.getId(), product.getStock()));
        return result;
    }

    public void restoreStocks(Map<String, Integer> stocks) {
        stocks.forEach((id, stock) -> {
            Product product = productMap.get(id);
            if (product != null) {
                product.setStock(stock);
            }
        });
    }
}
