package com.kai987.smartinventory.domain;

import java.math.BigDecimal;

public final class Product {
    private static final String PRODUCT_ID_PATTERN = "P\\d{3}";

    private final String id;
    private final String name;
    private final String nameJa;
    private final String nameZh;
    private final String category;
    private final String imageUrl;
    private final long priceYen;
    private int stock;
    private final double weightKg;

    public Product(String id, String name, long priceYen, int stock, double weightKg) {
        this(id, name, priceYen, stock, weightKg, null, null);
    }

    public Product(String id, String name, long priceYen, int stock, double weightKg,
            String nameJa, String nameZh) {
        this(id, name, priceYen, stock, weightKg, nameJa, nameZh, null, null);
    }

    public Product(String id, String name, long priceYen, int stock, double weightKg,
            String nameJa, String nameZh, String category, String imageUrl) {
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
        this.nameJa = normalizeTranslation(nameJa);
        this.nameZh = normalizeTranslation(nameZh);
        if (category != null && !isValidCategory(category)) throw new IllegalArgumentException("Invalid product category.");
        if (imageUrl != null && !isValidImageUrl(imageUrl)) throw new IllegalArgumentException("Invalid product image URL.");
        this.category = category;
        this.imageUrl = imageUrl;
        this.priceYen = priceYen;
        this.stock = stock;
        this.weightKg = weightKg;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public String getNameJa() { return nameJa; }
    public String getNameZh() { return nameZh; }
    public String getCategory() { return category; }
    public String getImageUrl() { return imageUrl; }
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
        return new Product(id, name, priceYen, stock, weightKg, nameJa, nameZh, category, imageUrl);
    }

    public String toCsv() {
        String base = id + "," + name + "," + priceYen + "," + stock + "," + weightKg;
        if (category != null || imageUrl != null) return base + "," + (nameJa == null ? "" : nameJa)
                + "," + (nameZh == null ? "" : nameZh) + "," + (category == null ? "" : category)
                + "," + (imageUrl == null ? "" : imageUrl);
        return nameJa == null && nameZh == null ? base
                : base + "," + (nameJa == null ? "" : nameJa) + "," + (nameZh == null ? "" : nameZh);
    }

    public static Product fromCsv(String line) {
        String[] parts = line.split(",", -1);
        if (parts.length != 5 && parts.length != 7 && parts.length != 9) {
            return null;
        }
        try {
            long price = new BigDecimal(parts[2].trim()).longValueExact();
            return new Product(parts[0].trim(), parts[1].trim(), price,
                    Integer.parseInt(parts[3].trim()), Double.parseDouble(parts[4].trim()),
                    parts.length >= 7 ? parts[5] : null, parts.length >= 7 ? parts[6] : null,
                    parts.length == 9 && !parts[7].isEmpty() ? parts[7] : null,
                    parts.length == 9 && !parts[8].isEmpty() ? parts[8] : null);
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

    public static String normalizeTranslation(String name) {
        if (name == null) return null;
        if (name.length() > 100 || containsReservedCharacter(name)) {
            throw new IllegalArgumentException("Invalid translated product name.");
        }
        if (name.trim().isEmpty()) return null;
        return name.trim();
    }

    public static boolean isValidCategory(String category) {
        return category != null && java.util.Set.of("electronics", "home", "kitchen", "travel", "sports", "stationery", "other").contains(category);
    }

    public static boolean isValidImageUrl(String imageUrl) {
        return imageUrl != null && imageUrl.matches("/api/product-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp)");
    }

    public static boolean containsReservedCharacter(String text) {
        return text != null && (text.contains(",") || text.contains("|")
                || text.contains(":") || text.contains("\n") || text.contains("\r"));
    }

    public static boolean isPositiveFinite(double value) {
        return value > 0.0 && Double.isFinite(value);
    }
}
