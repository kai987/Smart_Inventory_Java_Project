package com.kai987.smartinventory.persistence;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
public class SeedDataInitializer {
    private static final String[] FILE_NAMES = {"users.csv", "products.csv", "orders.csv"};

    public Path initializeAndReturn(Path dataDirectory) {
        initialize(dataDirectory);
        return dataDirectory;
    }

    public void initialize(Path dataDirectory) {
        try {
            Files.createDirectories(dataDirectory);
            for (String fileName : FILE_NAMES) {
                Path target = dataDirectory.resolve(fileName);
                if (Files.exists(target)) {
                    continue;
                }
                ClassPathResource resource = new ClassPathResource("seed-data/" + fileName);
                Path temporary = Files.createTempFile(dataDirectory, fileName, ".seed.tmp");
                try (InputStream input = resource.getInputStream()) {
                    Files.copy(input, temporary, StandardCopyOption.REPLACE_EXISTING);
                    move(temporary, target);
                } finally {
                    Files.deleteIfExists(temporary);
                }
            }
        } catch (IOException exception) {
            throw new PersistenceException("Could not initialize the runtime data directory.", exception);
        }
    }

    private void move(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException exception) {
            Files.move(source, target);
        }
    }
}
