package com.kai987.smartinventory.domain;

public final class OrderItem {
    private final String productId;
    private final String productName;
    private final String productNameJa;
    private final String productNameZh;
    private final String productImageUrl;
    private final long unitPriceYen;
    private final double unitWeightKg;
    private final int quantity;
    private final long subtotalYen;
    private final double totalWeightKg;

    public OrderItem(Product product, int quantity) {
        this(requireProduct(product).getId(), product.getName(), product.getPriceYen(),
                product.getWeightKg(), quantity, product.getNameJa(), product.getNameZh(), product.getImageUrl());
    }

    public OrderItem(String productId, String productName, long unitPriceYen,
            double unitWeightKg, int quantity) {
        this(productId, productName, unitPriceYen, unitWeightKg, quantity, null, null);
    }

    public OrderItem(String productId, String productName, long unitPriceYen,
            double unitWeightKg, int quantity, String productNameJa, String productNameZh) {
        this(productId, productName, unitPriceYen, unitWeightKg, quantity, productNameJa, productNameZh, null);
    }

    public OrderItem(String productId, String productName, long unitPriceYen,
            double unitWeightKg, int quantity, String productNameJa, String productNameZh, String productImageUrl) {
        if (!Product.isValidId(productId) || !Product.isValidName(productName)) {
            throw new IllegalArgumentException("Invalid product snapshot.");
        }
        if (unitPriceYen <= 0 || !Product.isPositiveFinite(unitWeightKg) || quantity <= 0) {
            throw new IllegalArgumentException("Invalid order item values.");
        }
        try {
            this.subtotalYen = Math.multiplyExact(unitPriceYen, (long) quantity);
        } catch (ArithmeticException exception) {
            throw new IllegalArgumentException("Order item subtotal is too large.", exception);
        }
        double weight = unitWeightKg * quantity;
        if (!Product.isPositiveFinite(weight)) {
            throw new IllegalArgumentException("Order item total weight is too large.");
        }
        this.productId = productId;
        this.productName = productName;
        this.productNameJa = Product.normalizeTranslation(productNameJa);
        this.productNameZh = Product.normalizeTranslation(productNameZh);
        if (productImageUrl != null && !Product.isValidImageUrl(productImageUrl)) throw new IllegalArgumentException("Invalid product image URL.");
        this.productImageUrl = productImageUrl;
        this.unitPriceYen = unitPriceYen;
        this.unitWeightKg = unitWeightKg;
        this.quantity = quantity;
        this.totalWeightKg = weight;
    }

    public String getProductId() { return productId; }
    public String getProductName() { return productName; }
    public String getProductNameJa() { return productNameJa; }
    public String getProductNameZh() { return productNameZh; }
    public String getProductImageUrl() { return productImageUrl; }
    public long getUnitPriceYen() { return unitPriceYen; }
    public double getUnitWeightKg() { return unitWeightKg; }
    public int getQuantity() { return quantity; }
    public long getSubtotalYen() { return subtotalYen; }
    public double getTotalWeightKg() { return totalWeightKg; }

    public String toCsvPart() {
        String base = productId + ":" + productName + ":" + unitPriceYen + ":"
                + unitWeightKg + ":" + quantity;
        if (productImageUrl != null) return base + ":" + (productNameJa == null ? "" : productNameJa)
                + ":" + (productNameZh == null ? "" : productNameZh) + ":" + productImageUrl;
        return productNameJa == null && productNameZh == null ? base
                : base + ":" + (productNameJa == null ? "" : productNameJa)
                        + ":" + (productNameZh == null ? "" : productNameZh);
    }

    private static Product requireProduct(Product product) {
        if (product == null) {
            throw new IllegalArgumentException("Product cannot be null.");
        }
        return product;
    }
}
