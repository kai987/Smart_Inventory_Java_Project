package com.kai987.smartinventory.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.kai987.smartinventory.SmartInventoryApplication;
import com.kai987.smartinventory.service.SmartInventoryService;

class EmptyCollectionsRestartTest {
    private static final String USERS = "alice,{noop}pass123,CUSTOMER\n";
    private static final String PRODUCT = "P001,Last Product,1200,3,0.3\n";
    private static final String ORDER = "O001,alice,P001:Historical Product:1200:0.3:1\n";
    private static final String[] FILE_NAMES = {"users.csv", "products.csv", "orders.csv"};
    private final PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();

    @TempDir
    Path dataDirectory;

    @Test
    void deletingLastProductCanRestartWithoutLosingHistoricalOrdersOrRestoringSeeds() throws Exception {
        writeFixture(dataDirectory, USERS, PRODUCT, ORDER);
        SmartInventoryService service = service(dataDirectory);

        service.deleteProduct("P001");
        assertTrue(service.listProducts(null, false).isEmpty());
        assertEquals("", Files.readString(dataDirectory.resolve("products.csv")));

        SmartInventoryService restarted = service(dataDirectory);
        assertTrue(restarted.listProducts(null, false).isEmpty());
        assertEquals(1, restarted.allOrders(null).size());
        assertEquals("Historical Product", restarted.allOrders(null).getFirst().getItems().getFirst().getProductName());
        assertEquals(USERS, Files.readString(dataDirectory.resolve("users.csv")));
        assertEquals(ORDER, Files.readString(dataDirectory.resolve("orders.csv")));
        assertEquals("", Files.readString(dataDirectory.resolve("products.csv")));
    }

    @Test
    void emptyOrderHistoryLoadsAndRestartsWithoutChangingSavedInventory() throws Exception {
        writeFixture(dataDirectory, USERS, PRODUCT, "");

        assertTrue(service(dataDirectory).allOrders(null).isEmpty());
        SmartInventoryService restarted = service(dataDirectory);
        assertTrue(restarted.allOrders(null).isEmpty());
        assertEquals(3, restarted.getProduct("P001").getStock());
        assertEquals(PRODUCT, Files.readString(dataDirectory.resolve("products.csv")));
        assertEquals("", Files.readString(dataDirectory.resolve("orders.csv")));
    }

    @Test
    void applicationStartsWithExistingEmptyProductAndOrderFilesWithoutReseedingThem() throws Exception {
        writeFixture(dataDirectory, USERS, "", "");

        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(SmartInventoryApplication.class)
                .run("--app.data-dir=" + dataDirectory, "--server.port=0",
                        "--spring.main.banner-mode=off", "--spring.main.log-startup-info=false",
                        "--logging.level.root=OFF")) {
            SmartInventoryService service = context.getBean(SmartInventoryService.class);
            assertTrue(service.listProducts(null, false).isEmpty());
            assertTrue(service.allOrders(null).isEmpty());
            assertTrue(service.findUser("alice").isPresent());
        }

        assertEquals(USERS, Files.readString(dataDirectory.resolve("users.csv")));
        assertEquals("", Files.readString(dataDirectory.resolve("products.csv")));
        assertEquals("", Files.readString(dataDirectory.resolve("orders.csv")));
    }

    @Test
    void emptyUsersStillFailWithoutOverwritingAnyFile() throws Exception {
        writeFixture(dataDirectory, "", PRODUCT, ORDER);
        Map<String, String> before = contents(dataDirectory);

        assertThrows(PersistenceException.class, () -> service(dataDirectory));

        assertEquals(before, contents(dataDirectory));
    }

    @Test
    void missingRequiredFilesStillFailWithoutCreatingOrOverwritingData() throws Exception {
        for (String filename : FILE_NAMES) {
            Path directory = Files.createDirectory(dataDirectory.resolve("missing-" + filename));
            writeFixture(directory, USERS, PRODUCT, ORDER);
            Files.delete(directory.resolve(filename));
            Map<String, String> before = contents(directory);

            assertThrows(PersistenceException.class, () -> service(directory), filename);

            assertFalse(Files.exists(directory.resolve(filename)), filename);
            assertEquals(before, contents(directory), filename);
        }
    }

    @Test
    void nonRegularRequiredFilesStillFailWithoutOverwritingOtherData() throws Exception {
        for (String filename : FILE_NAMES) {
            Path directory = Files.createDirectory(dataDirectory.resolve("directory-" + filename));
            writeFixture(directory, USERS, PRODUCT, ORDER);
            Files.delete(directory.resolve(filename));
            Files.createDirectory(directory.resolve(filename));
            Map<String, String> before = contents(directory);

            assertThrows(PersistenceException.class, () -> service(directory), filename);

            assertTrue(Files.isDirectory(directory.resolve(filename)), filename);
            assertEquals(before, contents(directory), filename);
        }
    }

    @Test
    void unreadableProductFileStillFailsWithoutOverwritingAnyFile() throws Exception {
        writeFixture(dataDirectory, USERS, PRODUCT, ORDER);
        Path products = dataDirectory.resolve("products.csv");
        assumeTrue(Files.getFileStore(products).supportsFileAttributeView(PosixFileAttributeView.class));
        Map<String, String> before = contents(dataDirectory);
        Set<PosixFilePermission> permissions = Files.getPosixFilePermissions(products);
        try {
            Files.setPosixFilePermissions(products, Set.of(PosixFilePermission.OWNER_WRITE));
            assumeTrue(!Files.isReadable(products), "The current process bypasses file read permissions.");

            assertThrows(PersistenceException.class, () -> service(dataDirectory));
        } finally {
            Files.setPosixFilePermissions(products, permissions);
        }
        assertEquals(before, contents(dataDirectory));
    }

    @Test
    void corruptRowsAndBlankRowsStillFailWithoutOverwritingAnyFile() throws Exception {
        for (String filename : FILE_NAMES) {
            for (String invalid : new String[]{"damaged,row\n", "\n", "   \n"}) {
                Path directory = Files.createTempDirectory(dataDirectory, "invalid-");
                writeFixture(directory, USERS, PRODUCT, ORDER);
                Files.writeString(directory.resolve(filename), invalid, StandardCharsets.UTF_8);
                Map<String, String> before = contents(directory);

                assertThrows(PersistenceException.class, () -> service(directory), filename + ": " + invalid);

                assertEquals(before, contents(directory), filename);
            }
        }
    }

    private SmartInventoryService service(Path directory) {
        return new SmartInventoryService(new CsvFileManager(directory), encoder);
    }

    private static void writeFixture(Path directory, String users, String products, String orders) throws Exception {
        Files.writeString(directory.resolve("users.csv"), users, StandardCharsets.UTF_8);
        Files.writeString(directory.resolve("products.csv"), products, StandardCharsets.UTF_8);
        Files.writeString(directory.resolve("orders.csv"), orders, StandardCharsets.UTF_8);
    }

    private static Map<String, String> contents(Path directory) throws Exception {
        Map<String, String> contents = new LinkedHashMap<>();
        for (String filename : FILE_NAMES) {
            Path file = directory.resolve(filename);
            if (Files.isRegularFile(file)) contents.put(filename, Files.readString(file, StandardCharsets.UTF_8));
        }
        return contents;
    }
}
