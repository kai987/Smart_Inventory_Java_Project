package com.kai987.smartinventory.domain;

import java.util.List;

public final class Order {
    public static final double BOX_LIMIT_KG = 10.0;

    private final String orderId;
    private final String customerName;
    private final List<OrderItem> items;
    private final long totalPriceYen;
    private final double totalWeightKg;
    private final int estimatedBoxes;

    public Order(String orderId, String customerName, List<OrderItem> items) {
        if (orderId == null || orderId.isBlank() || Product.containsReservedCharacter(orderId)) {
            throw new IllegalArgumentException("Order ID is invalid.");
        }
        if (!User.isValidUsername(customerName)) {
            throw new IllegalArgumentException("Customer name is invalid.");
        }
        if (items == null || items.isEmpty() || items.stream().anyMatch(item -> item == null)) {
            throw new IllegalArgumentException("An order must contain valid items.");
        }
        this.orderId = orderId;
        this.customerName = customerName;
        this.items = List.copyOf(items);

        long price = 0L;
        double weight = 0.0;
        try {
            for (OrderItem item : items) {
                price = Math.addExact(price, item.getSubtotalYen());
                weight += item.getTotalWeightKg();
                if (!Product.isPositiveFinite(weight)) {
                    throw new IllegalArgumentException("Order total weight is too large.");
                }
            }
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException("Order total price is too large.", exception);
        }
        double boxes = Math.ceil(weight / BOX_LIMIT_KG);
        if (boxes > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Order requires too many boxes.");
        }
        this.totalPriceYen = price;
        this.totalWeightKg = weight;
        this.estimatedBoxes = (int) boxes;
    }

    public String getOrderId() { return orderId; }
    public String getCustomerName() { return customerName; }
    public List<OrderItem> getItems() { return items; }
    public long getTotalPriceYen() { return totalPriceYen; }
    public double getTotalWeightKg() { return totalWeightKg; }
    public int getEstimatedBoxes() { return estimatedBoxes; }

    public String toCsv() {
        return orderId + "," + customerName + ","
                + items.stream().map(OrderItem::toCsvPart).reduce((a, b) -> a + "|" + b).orElseThrow();
    }
}
