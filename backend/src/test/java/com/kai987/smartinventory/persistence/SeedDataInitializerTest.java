package com.kai987.smartinventory.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SeedDataInitializerTest {
    @TempDir
    Path dataDirectory;

    @Test
    void initializerCopiesOnlyMissingFilesAndNeverOverwritesExistingData() throws Exception {
        Path products = dataDirectory.resolve("products.csv");
        String customProducts = "P999,Custom,1,0,1.0\n";
        Files.writeString(products, customProducts);

        SeedDataInitializer initializer = new SeedDataInitializer();
        initializer.initialize(dataDirectory);
        initializer.initialize(dataDirectory);

        assertEquals(customProducts, Files.readString(products));
        assertTrue(Files.readString(dataDirectory.resolve("users.csv")).contains("{bcrypt}"));
        assertTrue(Files.readString(dataDirectory.resolve("orders.csv")).contains("P001:Laptop"));
    }
}
