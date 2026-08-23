package com.kai987.smartinventory.persistence;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import com.kai987.smartinventory.config.AppProperties;
import com.kai987.smartinventory.domain.InventoryManager;
import com.kai987.smartinventory.domain.Order;
import com.kai987.smartinventory.domain.OrderManager;
import com.kai987.smartinventory.domain.Product;
import com.kai987.smartinventory.domain.Role;
import com.kai987.smartinventory.domain.User;

@Component
public class CsvFileManager {
    private static final Logger LOGGER = LoggerFactory.getLogger(CsvFileManager.class);
    private final Path dataDirectory;
    private final Path usersFile;
    private final Path productsFile;
    private final Path ordersFile;

    @Autowired
    public CsvFileManager(AppProperties properties, SeedDataInitializer initializer) {
        this(initializer.initializeAndReturn(properties.getDataDir()));
    }

    public CsvFileManager(Path dataDirectory) {
        if (dataDirectory == null) {
            throw new IllegalArgumentException("Data directory cannot be null.");
        }
        this.dataDirectory = dataDirectory;
        this.usersFile = dataDirectory.resolve("users.csv");
        this.productsFile = dataDirectory.resolve("products.csv");
        this.ordersFile = dataDirectory.resolve("orders.csv");
        try {
            Files.createDirectories(dataDirectory);
        } catch (IOException exception) {
            throw new PersistenceException("Could not create the data directory.", exception);
        }
    }

    public Path getDataDirectory() {
        return dataDirectory;
    }

    public List<User> loadUsers(PasswordEncoder encoder) {
        List<String> lines = readRequiredLines(usersFile);
        List<User> users = new ArrayList<>();
        Set<String> usernames = new HashSet<>();
        boolean migrationNeeded = false;

        for (int index = 0; index < lines.size(); index++) {
            String[] fields = lines.get(index).split(",", -1);
            if (fields.length != 3) {
                throw invalidRow(usersFile, index + 1);
            }
            String username = fields[0].trim();
            String storedPassword = fields[1];
            Role role;
            try {
                role = Role.valueOf(fields[2].trim());
            } catch (IllegalArgumentException exception) {
                throw invalidRow(usersFile, index + 1);
            }
            String normalized = username.toLowerCase(Locale.ROOT);
            if (!User.isValidUsername(username) || !usernames.add(normalized)) {
                throw invalidRow(usersFile, index + 1);
            }

            String passwordHash = storedPassword;
            if (!User.isEncodedPassword(storedPassword)) {
                if (!User.isValidRawPassword(storedPassword)) {
                    throw invalidRow(usersFile, index + 1);
                }
                passwordHash = encoder.encode(storedPassword);
                migrationNeeded = true;
            }
            try {
                users.add(new User(username, passwordHash, role));
            } catch (IllegalArgumentException exception) {
                throw invalidRow(usersFile, index + 1);
            }
        }

        if (migrationNeeded) {
            saveUsers(users);
        }
        return List.copyOf(users);
    }

    public List<Product> loadProducts() {
        List<String> lines = readRequiredLines(productsFile);
        List<Product> products = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (int index = 0; index < lines.size(); index++) {
            Product product = Product.fromCsv(lines.get(index));
            if (product == null || !ids.add(product.getId())) {
                throw invalidRow(productsFile, index + 1);
            }
            products.add(product);
        }
        return List.copyOf(products);
    }

    public List<Order> loadOrders(InventoryManager inventoryManager) {
        List<String> lines = readRequiredLines(ordersFile);
        List<Order> orders = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        OrderManager parser = new OrderManager(inventoryManager);
        for (int index = 0; index < lines.size(); index++) {
            Order order = parser.parseOrder(lines.get(index));
            if (order == null || !ids.add(order.getOrderId())) {
                throw invalidRow(ordersFile, index + 1);
            }
            orders.add(order);
        }
        return List.copyOf(orders);
    }

    public void saveUsers(List<User> users) {
        writeTransaction(Map.of(usersFile, users.stream().map(User::toCsv).toList()));
    }

    public void saveProducts(List<Product> products) {
        writeTransaction(Map.of(productsFile, products.stream().map(Product::toCsv).toList()));
    }

    public void saveOrders(List<Order> orders) {
        writeTransaction(Map.of(ordersFile, orders.stream().map(Order::toCsv).toList()));
    }

    public void saveProductsAndOrders(List<Product> products, List<Order> orders) {
        Map<Path, List<String>> files = new LinkedHashMap<>();
        files.put(productsFile, products.stream().map(Product::toCsv).toList());
        files.put(ordersFile, orders.stream().map(Order::toCsv).toList());
        writeTransaction(files);
    }

    public void saveAll(List<User> users, List<Product> products, List<Order> orders) {
        Map<Path, List<String>> files = new LinkedHashMap<>();
        files.put(usersFile, users.stream().map(User::toCsv).toList());
        files.put(productsFile, products.stream().map(Product::toCsv).toList());
        files.put(ordersFile, orders.stream().map(Order::toCsv).toList());
        writeTransaction(files);
    }

    private List<String> readRequiredLines(Path path) {
        try {
            if (!Files.isRegularFile(path) || !Files.isReadable(path)) {
                throw new PersistenceException("A required data file cannot be read.");
            }
            List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
            if (lines.isEmpty()) {
                throw new PersistenceException("A required data file is empty.");
            }
            return lines;
        } catch (IOException exception) {
            throw new PersistenceException("A required data file could not be loaded.", exception);
        }
    }

    private void writeTransaction(Map<Path, List<String>> contents) {
        List<StagedFile> staged = new ArrayList<>();
        try {
            Files.createDirectories(dataDirectory);
            for (Map.Entry<Path, List<String>> entry : contents.entrySet()) {
                Path temporary = Files.createTempFile(dataDirectory,
                        "." + entry.getKey().getFileName(), ".tmp");
                Files.write(temporary, entry.getValue(), StandardCharsets.UTF_8,
                        StandardOpenOption.TRUNCATE_EXISTING);
                staged.add(new StagedFile(entry.getKey(), temporary));
            }

            for (StagedFile file : staged) {
                if (Files.exists(file.target)) {
                    file.backup = dataDirectory.resolve("." + file.target.getFileName() + "."
                            + UUID.randomUUID() + ".bak");
                    move(file.target, file.backup, false);
                    file.backedUp = true;
                }
                move(file.temporary, file.target, true);
                file.replaced = true;
            }
            staged.forEach(file -> file.backedUp = false);
        } catch (IOException | RuntimeException exception) {
            rollback(staged);
            throw exception instanceof PersistenceException persistenceException
                    ? persistenceException
                    : new PersistenceException("CSV files could not be saved atomically.", exception);
        } finally {
            cleanup(staged);
        }
    }

    private void rollback(List<StagedFile> staged) {
        staged.stream().sorted(Comparator.comparingInt(staged::indexOf).reversed()).forEach(file -> {
            try {
                if (file.replaced) {
                    Files.deleteIfExists(file.target);
                }
                if (file.backedUp && file.backup != null && Files.exists(file.backup)) {
                    move(file.backup, file.target, true);
                    file.backedUp = false;
                }
            } catch (IOException exception) {
                LOGGER.error("Could not restore the backup for {} after a failed CSV transaction.",
                        file.target.getFileName(), exception);
            }
        });
    }

    private void cleanup(List<StagedFile> staged) {
        for (StagedFile file : staged) {
            try {
                Files.deleteIfExists(file.temporary);
                if (file.backup != null && !file.backedUp) {
                    Files.deleteIfExists(file.backup);
                }
            } catch (IOException ignored) {
                // A later run may safely remove an abandoned hidden temporary file.
            }
        }
    }

    private void move(Path source, Path target, boolean replace) throws IOException {
        StandardCopyOption[] atomicOptions = replace
                ? new StandardCopyOption[] {StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING}
                : new StandardCopyOption[] {StandardCopyOption.ATOMIC_MOVE};
        StandardCopyOption[] fallbackOptions = replace
                ? new StandardCopyOption[] {StandardCopyOption.REPLACE_EXISTING}
                : new StandardCopyOption[] {};
        try {
            Files.move(source, target, atomicOptions);
        } catch (AtomicMoveNotSupportedException exception) {
            Files.move(source, target, fallbackOptions);
        }
    }

    private PersistenceException invalidRow(Path file, int lineNumber) {
        return new PersistenceException("Invalid or duplicate CSV row in "
                + file.getFileName() + " at line " + lineNumber + ".");
    }

    private static final class StagedFile {
        private final Path target;
        private final Path temporary;
        private Path backup;
        private boolean backedUp;
        private boolean replaced;

        private StagedFile(Path target, Path temporary) {
            this.target = target;
            this.temporary = temporary;
        }
    }
}
