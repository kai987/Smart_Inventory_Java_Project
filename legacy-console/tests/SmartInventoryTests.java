import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public class SmartInventoryTests {
    private static int passedTests = 0;

    public static void main(String[] args) throws Exception {
        testAtomicOrderRejectsCombinedQuantity();
        testSuccessfulOrderMergesDuplicateItems();
        testSnapshotSurvivesProductRemovalAndRestart();
        testLegacyOrderFormatStillLoads();
        testCsvAndRegexValidation();
        testManagerProtectsItsCollectionsAndIds();
        testFuzzySearchByIdAndNameIgnoringCase();
        testPackingBoundaries();
        testMalformedCsvStopsWithoutChangingOriginalData();
        testMalformedOrderOverflowIsRejected();

        System.out.println("All " + passedTests + " tests passed.");
    }

    private static void testAtomicOrderRejectsCombinedQuantity() {
        InventoryManager inventory = new InventoryManager();
        Product product = new Product("P001", "Laptop", 120000L, 6, 3.0);
        inventory.addProduct(product);
        OrderManager orders = new OrderManager(inventory);

        Order result = orders.createOrder("alice", Arrays.asList(
                new OrderItem(product, 4), new OrderItem(product, 4)));

        assertNull(result, "The whole order must be rejected when combined quantity exceeds stock.");
        assertEquals(6, product.getStock(), "Rejected order must not change stock.");
        assertEquals(0, orders.getOrders().size(), "Rejected order must not be stored.");
        pass();
    }

    private static void testSuccessfulOrderMergesDuplicateItems() {
        InventoryManager inventory = new InventoryManager();
        Product product = new Product("P001", "Laptop", 1000L, 10, 1.5);
        inventory.addProduct(product);
        OrderManager orders = new OrderManager(inventory);

        Order result = orders.createOrder("alice", Arrays.asList(
                new OrderItem(product, 3), new OrderItem(product, 4)));

        assertNotNull(result, "Valid order should be created.");
        assertEquals(3, product.getStock(), "Successful order should reduce combined quantity once.");
        assertEquals(1, result.getItems().size(), "Duplicate products should be merged in the order.");
        assertEquals(7, result.getItems().get(0).getQuantity(), "Merged quantity is incorrect.");
        assertEquals(7000L, result.getTotalPrice(), "Integer yen total is incorrect.");
        pass();
    }

    private static void testSnapshotSurvivesProductRemovalAndRestart() throws Exception {
        Path dataFolder = Files.createTempDirectory("smart-inventory-tests-");

        try {
            FileManager files = new FileManager(dataFolder);
            InventoryManager inventory = new InventoryManager();
            Product product = new Product("P001", "日本語商品", 500L, 5, 2.0);
            inventory.addProduct(product);
            OrderManager orders = new OrderManager(inventory);
            Order order = orders.createOrder("alice",
                    Arrays.asList(new OrderItem(product, 2)));
            assertNotNull(order, "Test order should be created.");

            inventory.removeProduct("P001");
            boolean saved = files.saveAll(
                    Arrays.asList(new User("alice", "pass123", Role.CUSTOMER)),
                    inventory.getProducts(), orders.getOrders());
            assertTrue(saved, "UTF-8 snapshot data should save successfully.");

            InventoryManager reloadedInventory = new InventoryManager();
            reloadedInventory.setProducts(files.loadProducts());
            List<Order> reloadedOrders = files.loadOrders(reloadedInventory);

            assertEquals(0, reloadedInventory.getProducts().size(),
                    "Removed product should remain removed.");
            assertEquals(1, reloadedOrders.size(),
                    "Historical order should load without the inventory product.");
            assertEquals("日本語商品", reloadedOrders.get(0).getItems().get(0).getProductName(),
                    "Order snapshot should preserve the product name.");
            assertEquals(1000L, reloadedOrders.get(0).getTotalPrice(),
                    "Order snapshot should preserve the original price.");
        } finally {
            deleteTree(dataFolder);
        }

        pass();
    }

    private static void testLegacyOrderFormatStillLoads() {
        InventoryManager inventory = new InventoryManager();
        inventory.addProduct(new Product("P001", "Laptop", 120000L, 6, 3.0));
        OrderManager orders = new OrderManager(inventory);

        Order legacyOrder = orders.parseOrder("O123,customer,P001:2");

        assertNotNull(legacyOrder, "Existing two-field order items should remain readable.");
        assertEquals(240000L, legacyOrder.getTotalPrice(), "Legacy order price is incorrect.");
        assertEquals("Laptop", legacyOrder.getItems().get(0).getProductName(),
                "Legacy order should be converted to a snapshot.");
        pass();
    }

    private static void testCsvAndRegexValidation() {
        Product legacyPrice = Product.fromCsv("P001,Laptop,120000.0,8,3.0");
        assertNotNull(legacyPrice, "Legacy whole-number decimal prices should migrate.");
        assertEquals(120000L, legacyPrice.getPrice(), "Migrated yen price is incorrect.");
        assertNull(Product.fromCsv("P001,Laptop,-1,8,3.0"),
                "Negative prices from CSV must be rejected.");
        assertNull(User.fromCsv("name,with,commas,pass,CUSTOMER"),
                "CSV delimiter injection must be rejected.");
        assertTrue(User.isValidUsername("user_01"), "Expected valid username was rejected.");
        assertFalse(User.isValidUsername("bad,name"), "Username with comma must be rejected.");
        assertTrue(Product.isValidId("P999"), "Expected product ID was rejected.");
        assertFalse(Product.isValidId("ABC"), "Invalid product ID was accepted.");

        boolean invalidNameRejected = false;
        try {
            new Product("P002", "Keyboard, Wireless", 1000L, 1, 1.0);
        } catch (IllegalArgumentException e) {
            invalidNameRejected = true;
        }
        assertTrue(invalidNameRejected, "Product name with CSV separator must be rejected.");
        pass();
    }

    private static void testManagerProtectsItsCollectionsAndIds() {
        InventoryManager inventory = new InventoryManager();
        assertTrue(inventory.addProduct(new Product("P001", "Laptop", 1000L, 1, 1.0)),
                "First product should be added.");
        assertFalse(inventory.addProduct(new Product("P001", "Other", 2000L, 2, 2.0)),
                "Manager must reject duplicate product IDs.");

        boolean collectionProtected = false;
        try {
            inventory.getProducts().clear();
        } catch (UnsupportedOperationException e) {
            collectionProtected = true;
        }
        assertTrue(collectionProtected, "Inventory list must be read-only to callers.");
        assertNotNull(inventory.findProductById("P001"),
                "Protected collection attempt must not corrupt the product index.");
        pass();
    }

    private static void testFuzzySearchByIdAndNameIgnoringCase() {
        InventoryManager inventory = new InventoryManager();
        inventory.addProduct(new Product("P001", "Laptop", 120000L, 5, 3.0));
        inventory.addProduct(new Product("P002", "Wireless Mouse", 2500L, 10, 0.2));

        assertEquals(2, inventory.search("p00").size(),
                "Partial lowercase product ID should match both IDs.");
        assertEquals("Laptop", inventory.search("LAP").get(0).getName(),
                "Uppercase partial name should match ignoring case.");
        assertEquals("P002", inventory.search("mouse").get(0).getId(),
                "Partial lowercase name should match ignoring case.");
        assertEquals(0, inventory.search("missing").size(),
                "Unknown keyword should return an empty result list.");
        pass();
    }

    private static void testPackingBoundaries() {
        Order tenKg = new Order("O1", "alice", Arrays.asList(
                new OrderItem(new Product("P001", "ItemA", 100L, 1, 10.0), 1)));
        Order overTenKg = new Order("O2", "alice", Arrays.asList(
                new OrderItem(new Product("P002", "ItemB", 100L, 1, 10.01), 1)));

        assertEquals(1, tenKg.estimateBoxes(), "Exactly 10 kg should use one box.");
        assertEquals(2, overTenKg.estimateBoxes(), "More than 10 kg should use two boxes.");
        pass();
    }

    private static void testMalformedCsvStopsWithoutChangingOriginalData() throws Exception {
        Path dataFolder = Files.createTempDirectory("smart-inventory-load-protection-");
        Path productsFile = dataFolder.resolve("products.csv");
        List<String> originalLines = Arrays.asList(
                "P001,Laptop,120000,8,3.0",
                "this row is damaged");

        try {
            Files.write(productsFile, originalLines, StandardCharsets.UTF_8);
            FileManager files = new FileManager(dataFolder);

            boolean loadStopped = false;
            try {
                files.loadProducts();
            } catch (IllegalStateException e) {
                loadStopped = true;
            }

            assertTrue(loadStopped, "Malformed CSV must stop loading instead of returning partial data.");
            assertEquals(originalLines, Files.readAllLines(productsFile, StandardCharsets.UTF_8),
                    "Failed load must not modify the original CSV file.");

            Files.delete(productsFile);
            Files.createDirectory(productsFile);
            boolean readFailureStopped = false;
            try {
                files.loadProducts();
            } catch (IllegalStateException e) {
                readFailureStopped = true;
            }
            assertTrue(readFailureStopped, "An unreadable data path must stop loading.");
            assertTrue(Files.isDirectory(productsFile),
                    "Read failure must leave the original data path unchanged.");
        } finally {
            deleteTree(dataFolder);
        }

        pass();
    }

    private static void testMalformedOrderOverflowIsRejected() {
        OrderManager parser = new OrderManager(new InventoryManager());

        assertNull(parser.parseOrder(
                        "O1,alice,P001:ItemA:9223372036854775807:1.0:2"),
                "Order item subtotal overflow must be rejected while parsing.");

        long halfPlusOne = Long.MAX_VALUE / 2L + 1L;
        assertNull(parser.parseOrder(
                        "O2,alice,P001:ItemA:" + halfPlusOne + ":1.0:1"
                                + "|P002:ItemB:" + halfPlusOne + ":1.0:1"),
                "Order total price overflow must be rejected while parsing.");

        assertNull(parser.parseOrder(
                        "O3,alice,P001:ItemA:1:" + Double.MAX_VALUE + ":2"),
                "Order item weight overflow must be rejected while parsing.");

        assertNull(parser.parseOrder(
                        "O4,alice,P001:ItemA:1:" + Double.MAX_VALUE + ":1"),
                "An order requiring more than Integer.MAX_VALUE boxes must be rejected.");
        pass();
    }

    private static void deleteTree(Path root) throws IOException {
        try (Stream<Path> paths = Files.walk(root)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).collect(Collectors.toList())) {
                Files.deleteIfExists(path);
            }
        }
    }

    private static void pass() {
        passedTests++;
    }

    private static void assertTrue(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private static void assertFalse(boolean condition, String message) {
        assertTrue(!condition, message);
    }

    private static void assertNull(Object value, String message) {
        assertTrue(value == null, message);
    }

    private static void assertNotNull(Object value, String message) {
        assertTrue(value != null, message);
    }

    private static void assertEquals(long expected, long actual, String message) {
        if (expected != actual) {
            throw new AssertionError(message + " Expected " + expected + " but was " + actual + ".");
        }
    }

    private static void assertEquals(String expected, String actual, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + " Expected " + expected + " but was " + actual + ".");
        }
    }

    private static void assertEquals(List<String> expected, List<String> actual, String message) {
        if (!expected.equals(actual)) {
            throw new AssertionError(message + " Expected " + expected + " but was " + actual + ".");
        }
    }
}
