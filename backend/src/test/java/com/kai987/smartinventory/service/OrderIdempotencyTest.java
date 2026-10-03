package com.kai987.smartinventory.service;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;

import com.kai987.smartinventory.domain.Order;
import com.kai987.smartinventory.domain.OrderIdempotency;
import com.kai987.smartinventory.domain.OrderManager.RequestedItem;
import com.kai987.smartinventory.domain.Product;
import com.kai987.smartinventory.domain.User;
import com.kai987.smartinventory.persistence.CsvFileManager;
import com.kai987.smartinventory.persistence.PersistenceException;
import com.kai987.smartinventory.persistence.SeedDataInitializer;
import com.kai987.smartinventory.web.error.DomainException;
import com.kai987.smartinventory.web.error.ErrorCode;

class OrderIdempotencyTest {
    private static final String KEY = "checkout_1234567890";
    @TempDir Path directory;

    private SmartInventoryService open(CsvFileManager files) {
        new SeedDataInitializer().initialize(directory);
        return new SmartInventoryService(files, PasswordEncoderFactories.createDelegatingPasswordEncoder());
    }

    @Test void orderIdMatchesSharedCrossLanguageVectorAndCanonicalUsername() {
        String expected = "OI9582a2e4820a8f4d099338f727ce30d03d14583aace592e11346b43066c6e43d";
        assertEquals(expected, OrderIdempotency.orderId("customer", KEY));
        assertEquals(expected, OrderIdempotency.orderId("Customer", KEY));
    }

    @Test void sameIntentReplaysAfterRestartAndProductDeletion() {
        var service = open(new CsvFileManager(directory));
        var order = service.createOrder("customer", List.of(new RequestedItem("P002", 2)), KEY);
        assertEquals(28, service.getProduct("P002").getStock());
        var replay = service.createOrder("customer", List.of(new RequestedItem("P002", 1),
                new RequestedItem("P002", 1)), KEY);
        assertEquals(order.getOrderId(), replay.getOrderId());
        assertEquals(28, service.getProduct("P002").getStock());
        service.deleteProduct("P002");
        var reopened = open(new CsvFileManager(directory));
        assertEquals(order.getOrderId(), reopened.createOrder("customer",
                List.of(new RequestedItem("P002", 2)), KEY).getOrderId());
    }

    @Test void conflictingIntentAndMalformedKeyDoNotChangeStock() {
        var service = open(new CsvFileManager(directory));
        service.createOrder("customer", List.of(new RequestedItem("P002", 1)), KEY);
        var conflict = assertThrows(DomainException.class, () -> service.createOrder("customer",
                List.of(new RequestedItem("P002", 2)), KEY));
        assertEquals(ErrorCode.IDEMPOTENCY_CONFLICT, conflict.getErrorCode());
        assertThrows(DomainException.class, () -> service.createOrder("customer",
                List.of(new RequestedItem("P002", 1)), "short"));
        assertThrows(DomainException.class, () -> service.createOrder("customer",
                List.of(new RequestedItem("P002", 0)), KEY));
        assertEquals(29, service.getProduct("P002").getStock());
    }

    @Test void keyIsScopedToCustomerAndUnkeyedOrdersRemainDistinct() {
        var service = open(new CsvFileManager(directory));
        var items = List.of(new RequestedItem("P002", 1));
        var a = service.createOrder("customer", items, KEY);
        var b = service.createOrder("yqk", items, KEY);
        assertNotEquals(a.getOrderId(), b.getOrderId());
        assertNotEquals(service.createOrder("customer", items).getOrderId(),
                service.createOrder("customer", items).getOrderId());
        assertEquals(26, service.getProduct("P002").getStock());
    }

    @Test void concurrentRequestsCommitOneOrder() throws Exception {
        var service = open(new CsvFileManager(directory));
        int previous = service.allOrders(null).size();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = executor.submit(() -> service.createOrder("customer", List.of(new RequestedItem("P002", 2)), KEY));
            var b = executor.submit(() -> service.createOrder("customer", List.of(new RequestedItem("P002", 2)), KEY));
            assertEquals(a.get(5, TimeUnit.SECONDS).getOrderId(), b.get(5, TimeUnit.SECONDS).getOrderId());
        }
        assertEquals(previous + 1, service.allOrders(null).size());
        assertEquals(28, service.getProduct("P002").getStock());
    }

    @Test void failedSaveDoesNotConsumeKeyAndRetryCanSucceed() {
        var files = new CsvFileManager(directory) {
            boolean fail = true;
            @Override public void saveProductsAndOrders(List<Product> products, List<Order> orders) {
                if (fail) {
                    fail = false;
                    throw new PersistenceException("simulated");
                }
                super.saveProductsAndOrders(products, orders);
            }
        };
        var service = open(files);
        var items = List.of(new RequestedItem("P002", 2));
        assertThrows(PersistenceException.class, () -> service.createOrder("customer", items, KEY));
        assertEquals(30, service.getProduct("P002").getStock());
        var order = service.createOrder("customer", items, KEY);
        assertEquals(order.getOrderId(), service.createOrder("customer", items, KEY).getOrderId());
        assertEquals(28, service.getProduct("P002").getStock());
    }

    @Test void passwordUtf8BoundariesMatchRust() {
        assertTrue(User.isValidRawPassword("a".repeat(72)));
        assertFalse(User.isValidRawPassword("a".repeat(73)));
        assertTrue(User.isValidRawPassword("中".repeat(24)));
        assertFalse(User.isValidRawPassword("中".repeat(25)));
    }
}
