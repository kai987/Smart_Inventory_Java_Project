package com.kai987.smartinventory.domain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.kai987.smartinventory.web.error.DomainException;
import com.kai987.smartinventory.web.error.ErrorCode;

/** A keyed order's existing CSV ID is its durable retry record. */
public final class OrderIdempotency {
    private OrderIdempotency() { }

    public static String orderId(String username, String key) {
        if (key == null) return null;
        if (!key.matches("[A-Za-z0-9_-]{16,128}")) {
            throw new DomainException(ErrorCode.VALIDATION_ERROR,
                    "Idempotency-Key must contain 16-128 letters, digits, underscores or hyphens.");
        }
        try {
            byte[] input = (username.toLowerCase(Locale.ROOT) + "\0" + key)
                    .getBytes(StandardCharsets.UTF_8);
            return "OI" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required by Java.", exception);
        }
    }

    public static Map<String, Integer> quantities(List<OrderManager.RequestedItem> items) {
        if (items == null || items.isEmpty()) throw new DomainException(ErrorCode.EMPTY_ORDER);
        Map<String, Integer> quantities = new LinkedHashMap<>();
        try {
            for (OrderManager.RequestedItem item : items) {
                if (item == null || !Product.isValidId(item.productId()) || item.quantity() <= 0) {
                    throw new DomainException(ErrorCode.VALIDATION_ERROR);
                }
                quantities.merge(item.productId(), item.quantity(), Math::addExact);
            }
        } catch (ArithmeticException exception) {
            throw new DomainException(ErrorCode.VALIDATION_ERROR, "Combined quantity is too large.");
        }
        return quantities;
    }

    public static boolean matches(Order order, String username, Map<String, Integer> quantities) {
        Map<String, Integer> existing = new LinkedHashMap<>();
        for (OrderItem item : order.getItems()) {
            existing.merge(item.getProductId(), item.getQuantity(), Math::addExact);
        }
        return order.getCustomerName().equalsIgnoreCase(username) && existing.equals(quantities);
    }
}
