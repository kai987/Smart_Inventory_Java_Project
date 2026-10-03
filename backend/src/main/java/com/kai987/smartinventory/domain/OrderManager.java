package com.kai987.smartinventory.domain;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.kai987.smartinventory.web.dto.error.FieldErrorResponse;
import com.kai987.smartinventory.web.error.DomainException;
import com.kai987.smartinventory.web.error.ErrorCode;

public final class OrderManager {
    public record RequestedItem(String productId, int quantity) { }

    private List<Order> orders = new ArrayList<>();
    private final InventoryManager inventoryManager;

    public OrderManager(InventoryManager inventoryManager) {
        if (inventoryManager == null) {
            throw new IllegalArgumentException("Inventory manager cannot be null.");
        }
        this.inventoryManager = inventoryManager;
    }

    public List<Order> getOrders() {
        return List.copyOf(orders);
    }

    public void setOrders(List<Order> orders) {
        if (orders == null || orders.stream().anyMatch(order -> order == null)) {
            throw new IllegalArgumentException("Orders cannot contain null values.");
        }
        Set<String> ids = new HashSet<>();
        for (Order order : orders) {
            if (!ids.add(order.getOrderId())) {
                throw new IllegalArgumentException("Duplicate order ID.");
            }
        }
        this.orders = new ArrayList<>(orders);
    }

    public Order createOrderOrThrow(String customerName, List<RequestedItem> requestedItems) {
        return createOrderOrThrow(customerName, requestedItems,
                "O" + UUID.randomUUID().toString().replace("-", ""));
    }

    public Order createOrderOrThrow(String customerName, List<RequestedItem> requestedItems, String orderId) {
        if (!User.isValidUsername(customerName)) {
            throw new DomainException(ErrorCode.VALIDATION_ERROR);
        }
        if (requestedItems == null || requestedItems.isEmpty()) {
            throw new DomainException(ErrorCode.EMPTY_ORDER);
        }

        Map<String, Integer> quantities = new LinkedHashMap<>();
        Map<String, Integer> firstIndexes = new LinkedHashMap<>();
        try {
            for (int index = 0; index < requestedItems.size(); index++) {
                RequestedItem item = requestedItems.get(index);
                if (item == null || item.quantity() <= 0 || !Product.isValidId(item.productId())) {
                    throw new DomainException(ErrorCode.VALIDATION_ERROR);
                }
                if (inventoryManager.findMutableProductById(item.productId()) == null) {
                    throw new DomainException(ErrorCode.PRODUCT_NOT_FOUND);
                }
                firstIndexes.putIfAbsent(item.productId(), index);
                quantities.merge(item.productId(), item.quantity(), Math::addExact);
            }
        } catch (ArithmeticException exception) {
            throw new DomainException(ErrorCode.VALIDATION_ERROR,
                    "The combined item quantity is too large.");
        }

        for (Map.Entry<String, Integer> entry : quantities.entrySet()) {
            Product product = inventoryManager.findMutableProductById(entry.getKey());
            if (entry.getValue() > product.getStock()) {
                throw new DomainException(ErrorCode.INSUFFICIENT_STOCK,
                        ErrorCode.INSUFFICIENT_STOCK.defaultMessage(),
                        List.of(new FieldErrorResponse(
                                "items[" + firstIndexes.get(entry.getKey()) + "].quantity",
                                "Requested quantity exceeds available stock.")));
            }
        }

        List<OrderItem> snapshots = new ArrayList<>();
        try {
            quantities.forEach((id, quantity) -> snapshots.add(
                    new OrderItem(inventoryManager.findMutableProductById(id), quantity)));
            Order order = new Order(orderId, customerName, snapshots);
            quantities.forEach((id, quantity) -> inventoryManager.findMutableProductById(id)
                    .reduceStock(quantity));
            orders.add(order);
            return order;
        } catch (IllegalArgumentException exception) {
            throw new DomainException(ErrorCode.VALIDATION_ERROR,
                    "The order values are too large or invalid.");
        }
    }

    public Order createOrder(String customerName, List<RequestedItem> items) {
        try {
            return createOrderOrThrow(customerName, items);
        } catch (DomainException exception) {
            return null;
        }
    }

    public boolean removeOrder(String orderId) {
        return orders.removeIf(order -> order.getOrderId().equals(orderId));
    }

    public Order parseOrder(String line) {
        String[] parts = line.split(",", 3);
        if (parts.length != 3 || parts[0].trim().isEmpty()
                || !User.isValidUsername(parts[1].trim())) {
            return null;
        }
        String[] itemParts = parts[2].split("\\|", -1);
        List<OrderItem> items = new ArrayList<>();
        for (String itemPart : itemParts) {
            OrderItem parsed = parseOrderItem(itemPart);
            if (parsed == null) {
                return null;
            }
            items.add(parsed);
        }
        try {
            return new Order(parts[0].trim(), parts[1].trim(), items);
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private OrderItem parseOrderItem(String itemPart) {
        String[] fields = itemPart.split(":", -1);
        try {
            if (fields.length == 2) {
                Product product = inventoryManager.findMutableProductById(fields[0].trim());
                return product == null ? null
                        : new OrderItem(product, Integer.parseInt(fields[1].trim()));
            }
            if (fields.length == 5) {
                return new OrderItem(fields[0].trim(), fields[1].trim(),
                        Long.parseLong(fields[2].trim()), Double.parseDouble(fields[3].trim()),
                        Integer.parseInt(fields[4].trim()));
            }
        } catch (IllegalArgumentException exception) {
            return null;
        }
        return null;
    }
}
