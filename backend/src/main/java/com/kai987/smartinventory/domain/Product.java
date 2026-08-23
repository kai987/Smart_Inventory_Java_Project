package com.kai987.smartinventory.domain;

import java.math.BigDecimal;

public final class Product {
    private static final String PRODUCT_ID_PATTERN = "P\\d{3}";

    private final String id;
    private final String name;
    private final long priceYen;
    private int stock;
    private final double weightKg;

    public Product(String id, String name, long priceYen, int stock, double weightKg) {
        if (!isValidId(id)) {
            throw new IllegalArgumentException("Product ID must use the format P followed by three digits.");
        }
        if (!isValidName(name)) {
            throw new IllegalArgumentException("Product name is invalid or contains a reserved character.");
        }
        if (priceYen <= 0) {
            throw new IllegalArgumentException("Price must be positive.");
        }
        if (stock < 0) {
            throw new IllegalArgumentException("Stock cannot be negative.");
        }
        if (!isPositiveFinite(weightKg)) {
            throw new IllegalArgumentException("Weight must be positive and finite.");
        }
        this.id = id;
        this.name = name;
        this.priceYen = priceYen;
        this.stock = stock;
        this.weightKg = weightKg;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public long getPriceYen() { return priceYen; }
    public int getStock() { return stock; }
    public double getWeightKg() { return weightKg; }

    public void setStock(int stock) {
        if (stock < 0) {
            throw new IllegalArgumentException("Stock cannot be negative.");
        }
        this.stock = stock;
    }

    public boolean reduceStock(int quantity) {
        if (quantity <= 0 || quantity > stock) {
            return false;
        }
        stock -= quantity;
        return true;
    }

    public Product copy() {
        return new Product(id, name, priceYen, stock, weightKg);
    }

    public String toCsv() {
        return id + "," + name + "," + priceYen + "," + stock + "," + weightKg;
    }

    public static Product fromCsv(String line) {
        String[] parts = line.split(",", -1);
        if (parts.length != 5) {
            return null;
        }
        try {
            long price = new BigDecimal(parts[2].trim()).longValueExact();
            return new Product(parts[0].trim(), parts[1].trim(), price,
                    Integer.parseInt(parts[3].trim()), Double.parseDouble(parts[4].trim()));
        } catch (ArithmeticException | IllegalArgumentException exception) {
            return null;
        }
    }

    public static boolean isValidId(String id) {
        return id != null && id.matches(PRODUCT_ID_PATTERN);
    }

    public static boolean isValidName(String name) {
        return name != null && !name.trim().isEmpty() && name.length() <= 100
                && !containsReservedCharacter(name);
    }

    public static boolean containsReservedCharacter(String text) {
        return text != null && (text.contains(",") || text.contains("|")
                || text.contains(":") || text.contains("\n") || text.contains("\r"));
    }

    public static boolean isPositiveFinite(double value) {
        return value > 0.0 && Double.isFinite(value);
    }
}
