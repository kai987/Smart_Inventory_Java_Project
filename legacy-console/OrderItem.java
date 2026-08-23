public class OrderItem {
    private final String productId;
    private final String productName;
    private final long unitPriceYen;
    private final double unitWeightKg;
    private final int quantity;
    private final long subtotalYen;
    private final double totalWeightKg;

    public OrderItem(Product product, int quantity) {
        this(requireProduct(product).getId(), product.getName(), product.getPrice(),
                product.getWeightKg(), quantity);
    }

    public OrderItem(String productId, String productName, long unitPriceYen,
            double unitWeightKg, int quantity) {
        if (!Product.isValidId(productId)) {
            throw new IllegalArgumentException("Invalid product ID in order item.");
        }
        if (!Product.isValidName(productName)) {
            throw new IllegalArgumentException("Invalid product name in order item.");
        }
        if (unitPriceYen <= 0) {
            throw new IllegalArgumentException("Unit price must be positive.");
        }
        if (!Product.isPositiveFinite(unitWeightKg)) {
            throw new IllegalArgumentException("Unit weight must be positive and finite.");
        }
        if (quantity <= 0) {
            throw new IllegalArgumentException("Quantity must be positive.");
        }

        long calculatedSubtotal;
        try {
            calculatedSubtotal = Math.multiplyExact(unitPriceYen, (long) quantity);
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException("Order item subtotal is too large.", e);
        }

        double calculatedWeight = unitWeightKg * quantity;
        if (!Product.isPositiveFinite(calculatedWeight)) {
            throw new IllegalArgumentException("Order item total weight is too large.");
        }

        this.productId = productId;
        this.productName = productName;
        this.unitPriceYen = unitPriceYen;
        this.unitWeightKg = unitWeightKg;
        this.quantity = quantity;
        subtotalYen = calculatedSubtotal;
        totalWeightKg = calculatedWeight;
    }

    public String getProductId() {
        return productId;
    }

    public String getProductName() {
        return productName;
    }

    public long getUnitPriceYen() {
        return unitPriceYen;
    }

    public double getUnitWeightKg() {
        return unitWeightKg;
    }

    public int getQuantity() {
        return quantity;
    }

    public long getSubtotal() {
        return subtotalYen;
    }

    public double getTotalWeight() {
        return totalWeightKg;
    }

    public String toCsvPart() {
        return productId + ":" + productName + ":" + unitPriceYen
                + ":" + unitWeightKg + ":" + quantity;
    }

    @Override
    public String toString() {
        return productName + " x " + quantity + " = " + getSubtotal() + " yen";
    }

    private static Product requireProduct(Product product) {
        if (product == null) {
            throw new IllegalArgumentException("Product cannot be null.");
        }
        return product;
    }
}
