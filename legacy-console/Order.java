import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Order {
    private static final double BOX_LIMIT_KG = 10.0;

    private final String orderId;
    private final String customerName;
    private final List<OrderItem> items;
    private final long totalPriceYen;
    private final double totalWeightKg;
    private final int estimatedBoxes;

    public Order(String orderId, String customerName, List<OrderItem> items) {
        if (orderId == null || orderId.trim().isEmpty()
                || Product.containsReservedCharacter(orderId)) {
            throw new IllegalArgumentException("Order ID is invalid.");
        }
        if (!User.isValidUsername(customerName)) {
            throw new IllegalArgumentException("Customer name is invalid.");
        }
        if (items == null || items.isEmpty() || items.contains(null)) {
            throw new IllegalArgumentException("An order must contain valid items.");
        }

        this.orderId = orderId;
        this.customerName = customerName;
        this.items = new ArrayList<OrderItem>(items);

        long calculatedPrice = 0L;
        double calculatedWeight = 0.0;

        try {
            for (OrderItem item : this.items) {
                calculatedPrice = Math.addExact(calculatedPrice, item.getSubtotal());
                calculatedWeight += item.getTotalWeight();
                if (!Product.isPositiveFinite(calculatedWeight)) {
                    throw new IllegalArgumentException("Order total weight is too large.");
                }
            }
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException("Order total price is too large.", e);
        }

        double calculatedBoxes = Math.ceil(calculatedWeight / BOX_LIMIT_KG);
        if (calculatedBoxes > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Order requires too many boxes.");
        }

        totalPriceYen = calculatedPrice;
        totalWeightKg = calculatedWeight;
        estimatedBoxes = (int) calculatedBoxes;
    }

    public String getOrderId() {
        return orderId;
    }

    public String getCustomerName() {
        return customerName;
    }

    public List<OrderItem> getItems() {
        return Collections.unmodifiableList(items);
    }

    public long getTotalPrice() {
        return totalPriceYen;
    }

    public double getTotalWeight() {
        return totalWeightKg;
    }

    public int estimateBoxes() {
        return estimatedBoxes;
    }

    public String toCsv() {
        StringBuilder builder = new StringBuilder();
        builder.append(orderId).append(",").append(customerName).append(",");

        for (int i = 0; i < items.size(); i++) {
            builder.append(items.get(i).toCsvPart());

            if (i < items.size() - 1) {
                builder.append("|");
            }
        }

        return builder.toString();
    }

    @Override
    public String toString() {
        StringBuilder builder = new StringBuilder();

        builder.append("Order ID: ").append(orderId).append("\n");
        builder.append("Customer: ").append(customerName).append("\n");
        builder.append("Items:\n");

        for (OrderItem item : items) {
            builder.append("  - ").append(item).append("\n");
        }

        builder.append("Total price: ").append(getTotalPrice()).append(" yen\n");
        builder.append("Total weight: ").append(String.format("%.2f", getTotalWeight())).append(" kg\n");
        builder.append("Estimated boxes: ").append(estimateBoxes()).append("\n");

        return builder.toString();
    }
}
