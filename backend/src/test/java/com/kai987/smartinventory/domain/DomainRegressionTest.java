package com.kai987.smartinventory.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.kai987.smartinventory.persistence.CsvFileManager;
import com.kai987.smartinventory.persistence.PersistenceException;
import com.kai987.smartinventory.web.error.DomainException;

class DomainRegressionTest {
    @TempDir
    Path tempDirectory;

    @Test
    void combinedDuplicateQuantityOverStockRejectsEntireOrder() {
        InventoryManager inventory = inventoryWith(new Product("P001", "Laptop", 120000L, 6, 3.0));
        OrderManager manager = new OrderManager(inventory);

        assertThrows(DomainException.class, () -> manager.createOrderOrThrow("alice", List.of(
                new OrderManager.RequestedItem("P001", 4),
                new OrderManager.RequestedItem("P001", 4))));
        assertEquals(6, inventory.findProductById("P001").getStock());
        assertTrue(manager.getOrders().isEmpty());
    }

    @Test
    void successfulDuplicateItemsMergeAndReduceCombinedStock() {
        InventoryManager inventory = inventoryWith(new Product("P001", "Laptop", 1000L, 10, 1.5));
        OrderManager manager = new OrderManager(inventory);

        Order result = manager.createOrderOrThrow("alice", List.of(
                new OrderManager.RequestedItem("P001", 3),
                new OrderManager.RequestedItem("P001", 4)));

        assertEquals(3, inventory.findProductById("P001").getStock());
        assertEquals(1, result.getItems().size());
        assertEquals(7, result.getItems().getFirst().getQuantity());
        assertEquals(7000L, result.getTotalPriceYen());
    }

    @Test
    void snapshotSurvivesProductRemovalAndRestart() throws Exception {
        CsvFileManager files = new CsvFileManager(tempDirectory);
        InventoryManager inventory = inventoryWith(new Product("P001", "日本語商品", 500L, 5, 2.0));
        OrderManager manager = new OrderManager(inventory);
        Order order = manager.createOrderOrThrow("alice",
                List.of(new OrderManager.RequestedItem("P001", 2)));
        inventory.removeProduct("P001");

        files.saveAll(List.of(new User("alice", "{noop}pass123", Role.CUSTOMER)),
                inventory.getProducts(), manager.getOrders());
        InventoryManager reloadedInventory = new InventoryManager();
        reloadedInventory.setProducts(List.of(new Product("P999", "Temporary", 1, 0, 1)));
        List<Order> reloaded = files.loadOrders(reloadedInventory);

        assertNotNull(order);
        assertEquals("日本語商品", reloaded.getFirst().getItems().getFirst().getProductName());
        assertEquals(1000L, reloaded.getFirst().getTotalPriceYen());
    }

    @Test
    void legacyTwoFieldOrderItemLoads() {
        InventoryManager inventory = inventoryWith(new Product("P001", "Laptop", 120000L, 6, 3.0));
        Order parsed = new OrderManager(inventory).parseOrder("O123,customer,P001:2");

        assertNotNull(parsed);
        assertEquals(240000L, parsed.getTotalPriceYen());
        assertEquals("Laptop", parsed.getItems().getFirst().getProductName());
    }

    @Test
    void wholeNumberDecimalPriceMigratesAndInvalidCsvValuesAreRejected() {
        Product migrated = Product.fromCsv("P001,Laptop,120000.0,8,3.0");
        assertNotNull(migrated);
        assertEquals(120000L, migrated.getPriceYen());
        assertNull(Product.fromCsv("P001,Laptop,-1,8,3.0"));
        assertNull(Product.fromCsv("P001,Laptop,1.5,8,3.0"));
        assertNull(Product.fromCsv("P001,Laptop,10,-1,3.0"));
        assertNull(Product.fromCsv("P001,Laptop,10,1,NaN"));
    }

    @Test
    void duplicateProductIdsAndExternalCollectionMutationAreRejected() {
        InventoryManager inventory = inventoryWith(new Product("P001", "Laptop", 1000L, 1, 1.0));
        assertFalse(inventory.addProduct(new Product("P001", "Other", 2000L, 2, 2.0)));
        assertThrows(UnsupportedOperationException.class, () -> inventory.getProducts().clear());

        Product detached = inventory.getProducts().getFirst();
        detached.setStock(99);
        assertEquals(1, inventory.findProductById("P001").getStock());
    }

    @Test
    void fuzzySearchMatchesIdAndNameIgnoringCase() {
        InventoryManager inventory = new InventoryManager();
        inventory.addProduct(new Product("P001", "Laptop", 120000L, 5, 3.0));
        inventory.addProduct(new Product("P002", "Wireless Mouse", 2500L, 10, 0.2));

        assertEquals(2, inventory.search("p00").size());
        assertEquals("Laptop", inventory.search("LAP").getFirst().getName());
        assertEquals("P002", inventory.search("mouse").getFirst().getId());
        assertTrue(inventory.search("missing").isEmpty());
    }

    @Test
    void packingBoundaryUsesCeilingAtTenKilograms() {
        Order exact = new Order("O1", "alice", List.of(
                new OrderItem(new Product("P001", "ItemA", 100L, 1, 10.0), 1)));
        Order over = new Order("O2", "alice", List.of(
                new OrderItem(new Product("P002", "ItemB", 100L, 1, 10.01), 1)));
        assertEquals(1, exact.getEstimatedBoxes());
        assertEquals(2, over.getEstimatedBoxes());
    }

    @Test
    void malformedCsvStopsWithoutOverwritingOriginal() throws Exception {
        Path products = tempDirectory.resolve("products.csv");
        List<String> original = List.of("P001,Laptop,120000,8,3.0", "damaged row");
        Files.write(products, original, StandardCharsets.UTF_8);
        CsvFileManager files = new CsvFileManager(tempDirectory);

        assertThrows(PersistenceException.class, files::loadProducts);
        assertEquals(original, Files.readAllLines(products, StandardCharsets.UTF_8));
    }

    @Test
    void duplicateProductIdsInCsvAreRejected() throws Exception {
        Path products = tempDirectory.resolve("products.csv");
        Files.write(products, List.of("P001,A,1,1,1.0", "P001,B,2,2,2.0"));
        assertThrows(PersistenceException.class, () -> new CsvFileManager(tempDirectory).loadProducts());
    }

    @Test
    void malformedOrderSubtotalTotalWeightAndBoxOverflowAreRejected() {
        OrderManager parser = new OrderManager(new InventoryManager());
        assertNull(parser.parseOrder("O1,alice,P001:ItemA:9223372036854775807:1.0:2"));
        long halfPlusOne = Long.MAX_VALUE / 2L + 1L;
        assertNull(parser.parseOrder("O2,alice,P001:ItemA:" + halfPlusOne
                + ":1.0:1|P002:ItemB:" + halfPlusOne + ":1.0:1"));
        assertNull(parser.parseOrder("O3,alice,P001:ItemA:1:" + Double.MAX_VALUE + ":2"));
        assertNull(parser.parseOrder("O4,alice,P001:ItemA:1:" + Double.MAX_VALUE + ":1"));
        assertNull(parser.parseOrder("O5,alice,P001:ItemA:1:" + Double.MAX_VALUE
                + ":1|P002:ItemB:1:" + Double.MAX_VALUE + ":1"));
    }

    private InventoryManager inventoryWith(Product product) {
        InventoryManager inventory = new InventoryManager();
        assertTrue(inventory.addProduct(product));
        return inventory;
    }
}
