import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public class OrderManager {
    private List<Order> orders;
    private final InventoryManager inventoryManager;

    public OrderManager(InventoryManager inventoryManager) {
        if (inventoryManager == null) {
            throw new IllegalArgumentException("Inventory manager cannot be null.");
        }
        this.inventoryManager = inventoryManager;
        orders = new ArrayList<Order>();
    }

    public List<Order> getOrders() {
        return Collections.unmodifiableList(orders);
    }

    public void setOrders(List<Order> orders) {
        if (orders == null || orders.contains(null)) {
            throw new IllegalArgumentException("Orders cannot contain null values.");
        }

        Set<String> orderIds = new HashSet<String>();
        for (Order order : orders) {
            if (!orderIds.add(order.getOrderId())) {
                throw new IllegalArgumentException("Duplicate order ID: " + order.getOrderId());
            }
        }
        this.orders = new ArrayList<Order>(orders);
    }

    public Order createOrder(String customerName, List<OrderItem> requestedItems) {
        if (!User.isValidUsername(customerName)
                || requestedItems == null || requestedItems.isEmpty()) {
            return null;
        }

        Map<String, Integer> requestedQuantities = new LinkedHashMap<String, Integer>();

        try {
            for (OrderItem item : requestedItems) {
                if (item == null || item.getQuantity() <= 0) {
                    return null;
                }

                Product product = inventoryManager.findProductById(item.getProductId());
                if (product == null) {
                    return null;
                }

                int previousQuantity = requestedQuantities.containsKey(product.getId())
                        ? requestedQuantities.get(product.getId()) : 0;
                requestedQuantities.put(product.getId(),
                        Math.addExact(previousQuantity, item.getQuantity()));
            }
        } catch (ArithmeticException e) {
            return null;
        }

        for (Map.Entry<String, Integer> entry : requestedQuantities.entrySet()) {
            Product product = inventoryManager.findProductById(entry.getKey());
            if (product == null || entry.getValue() > product.getStock()) {
                return null;
            }
        }

        List<OrderItem> normalizedItems = new ArrayList<OrderItem>();
        Order order;

        try {
            for (Map.Entry<String, Integer> entry : requestedQuantities.entrySet()) {
                Product product = inventoryManager.findProductById(entry.getKey());
                normalizedItems.add(new OrderItem(product, entry.getValue()));
            }

            String orderId = "O" + UUID.randomUUID().toString().replace("-", "");
            order = new Order(orderId, customerName, normalizedItems);
        } catch (IllegalArgumentException e) {
            return null;
        }

        Map<String, Integer> originalStocks = new LinkedHashMap<String, Integer>();

        for (Map.Entry<String, Integer> entry : requestedQuantities.entrySet()) {
            Product product = inventoryManager.findProductById(entry.getKey());
            originalStocks.put(entry.getKey(), product.getStock());

            if (!product.reduceStock(entry.getValue())) {
                restoreStocks(originalStocks);
                return null;
            }
        }

        orders.add(order);
        return order;
    }

    public void printAllOrders() {
        if (orders.isEmpty()) {
            System.out.println("No orders yet.");
            return;
        }

        System.out.println();
        System.out.println("---------- ORDER LIST ----------");

        for (Order order : orders) {
            System.out.println(order);
        }
    }

    public void printOrdersByCustomer(String customerName) {
        boolean found = false;

        for (Order order : orders) {
            if (order.getCustomerName().equalsIgnoreCase(customerName)) {
                System.out.println(order);
                found = true;
            }
        }

        if (!found) {
            System.out.println("No orders found.");
        }
    }

    public Order parseOrder(String line) {
        String[] parts = line.split(",", 3);

        if (parts.length != 3 || parts[0].trim().isEmpty()
                || !User.isValidUsername(parts[1].trim())) {
            return null;
        }

        String orderId = parts[0].trim();
        String customerName = parts[1].trim();
        String[] itemParts = parts[2].split("\\|", -1);
        List<OrderItem> items = new ArrayList<OrderItem>();

        for (String itemPart : itemParts) {
            OrderItem item = parseOrderItem(itemPart);
            if (item == null) {
                return null;
            }
            items.add(item);
        }

        try {
            return new Order(orderId, customerName, items);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private OrderItem parseOrderItem(String itemPart) {
        String[] fields = itemPart.split(":", -1);

        try {
            if (fields.length == 2) {
                Product product = inventoryManager.findProductById(fields[0].trim());
                int quantity = Integer.parseInt(fields[1].trim());
                return product == null ? null : new OrderItem(product, quantity);
            }

            if (fields.length == 5) {
                String productId = fields[0].trim();
                String productName = fields[1].trim();
                long unitPriceYen = Long.parseLong(fields[2].trim());
                double unitWeightKg = Double.parseDouble(fields[3].trim());
                int quantity = Integer.parseInt(fields[4].trim());
                return new OrderItem(productId, productName, unitPriceYen,
                        unitWeightKg, quantity);
            }
        } catch (IllegalArgumentException e) {
            return null;
        }

        return null;
    }

    private void restoreStocks(Map<String, Integer> originalStocks) {
        for (Map.Entry<String, Integer> entry : originalStocks.entrySet()) {
            Product product = inventoryManager.findProductById(entry.getKey());
            if (product != null) {
                product.setStock(entry.getValue());
            }
        }
    }
}
