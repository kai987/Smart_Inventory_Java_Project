package com.kai987.smartinventory.domain;

public final class OrderItem {
    private final String productId;
    private final String productName;
    private final long unitPriceYen;
    private final double unitWeightKg;
    private final int quantity;
    private final long subtotalYen;
    private final double totalWeightKg;

    public OrderItem(Product product, int quantity) {
        this(requireProduct(product).getId(), product.getName(), product.getPriceYen(),
                product.getWeightKg(), quantity);
    }

    public OrderItem(String productId, String productName, long unitPriceYen,
            double unitWeightKg, int quantity) {
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
        this.unitPriceYen = unitPriceYen;
        this.unitWeightKg = unitWeightKg;
        this.quantity = quantity;
        this.totalWeightKg = weight;
    }

    public String getProductId() { return productId; }
    public String getProductName() { return productName; }
    public long getUnitPriceYen() { return unitPriceYen; }
    public double getUnitWeightKg() { return unitWeightKg; }
    public int getQuantity() { return quantity; }
    public long getSubtotalYen() { return subtotalYen; }
    public double getTotalWeightKg() { return totalWeightKg; }

    public String toCsvPart() {
        return productId + ":" + productName + ":" + unitPriceYen + ":"
                + unitWeightKg + ":" + quantity;
    }

    private static Product requireProduct(Product product) {
        if (product == null) {
            throw new IllegalArgumentException("Product cannot be null.");
        }
        return product;
    }
}
