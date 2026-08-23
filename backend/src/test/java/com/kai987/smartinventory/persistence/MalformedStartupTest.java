package com.kai987.smartinventory.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import com.kai987.smartinventory.SmartInventoryApplication;

class MalformedStartupTest {
    @TempDir
    Path dataDirectory;

    @Test
    void malformedDataDirectoryPreventsApplicationStartupWithoutOverwrite() throws Exception {
        Path products = dataDirectory.resolve("products.csv");
        List<String> original = List.of("P001,Laptop,120000,8,3.0", "damaged");
        Files.write(products, original, StandardCharsets.UTF_8);

        assertThrows(Exception.class, () -> {
            try (ConfigurableApplicationContext ignored = new SpringApplicationBuilder(
                    SmartInventoryApplication.class).run(
                            "--app.data-dir=" + dataDirectory,
                            "--server.port=0",
                            "--spring.main.banner-mode=off",
                            "--spring.main.log-startup-info=false",
                            "--logging.level.root=OFF")) {
                // Startup is expected to fail before the context is returned.
            }
        });
        assertEquals(original, Files.readAllLines(products, StandardCharsets.UTF_8));
    }
}
