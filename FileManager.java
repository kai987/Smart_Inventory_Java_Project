import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class FileManager {
    private final Path dataFolder;
    private final Path usersFile;
    private final Path productsFile;
    private final Path ordersFile;

    public FileManager() {
        this(Paths.get("data"));
    }

    public FileManager(Path dataFolder) {
        if (dataFolder == null) {
            throw new IllegalArgumentException("Data folder cannot be null.");
        }

        this.dataFolder = dataFolder;
        usersFile = dataFolder.resolve("users.csv");
        productsFile = dataFolder.resolve("products.csv");
        ordersFile = dataFolder.resolve("orders.csv");

        try {
            Files.createDirectories(dataFolder);
        } catch (IOException e) {
            throw new IllegalStateException("Could not create data folder: " + dataFolder, e);
        }
    }

    public boolean usersFileExists() {
        return fileExists(usersFile);
    }

    public boolean productsFileExists() {
        return fileExists(productsFile);
    }

    public boolean ordersFileExists() {
        return fileExists(ordersFile);
    }

    public List<User> loadUsers() {
        List<User> users = new ArrayList<User>();
        Set<String> usernames = new HashSet<String>();

        if (!usersFileExists()) {
            return users;
        }

        try (BufferedReader reader = Files.newBufferedReader(usersFile, StandardCharsets.UTF_8)) {
            String line;
            int lineNumber = 0;

            while ((line = reader.readLine()) != null) {
                lineNumber++;
                User user = User.fromCsv(line);
                String key = user == null ? "" : user.getUsername().toLowerCase(Locale.ROOT);

                if (user == null || !usernames.add(key)) {
                    throw invalidRow(usersFile, lineNumber);
                }
                users.add(user);
            }
        } catch (IOException e) {
            throw loadFailure(usersFile, e);
        }

        return users;
    }

    public List<Product> loadProducts() {
        List<Product> products = new ArrayList<Product>();
        Set<String> productIds = new HashSet<String>();

        if (!productsFileExists()) {
            return products;
        }

        try (BufferedReader reader = Files.newBufferedReader(productsFile, StandardCharsets.UTF_8)) {
            String line;
            int lineNumber = 0;

            while ((line = reader.readLine()) != null) {
                lineNumber++;
                Product product = Product.fromCsv(line);

                if (product == null || !productIds.add(product.getId())) {
                    throw invalidRow(productsFile, lineNumber);
                }
                products.add(product);
            }
        } catch (IOException e) {
            throw loadFailure(productsFile, e);
        }

        return products;
    }

    public List<Order> loadOrders(InventoryManager inventoryManager) {
        List<Order> orders = new ArrayList<Order>();
        Set<String> orderIds = new HashSet<String>();

        if (!ordersFileExists()) {
            return orders;
        }

        OrderManager parser = new OrderManager(inventoryManager);

        try (BufferedReader reader = Files.newBufferedReader(ordersFile, StandardCharsets.UTF_8)) {
            String line;
            int lineNumber = 0;

            while ((line = reader.readLine()) != null) {
                lineNumber++;
                Order order = parser.parseOrder(line);

                if (order == null || !orderIds.add(order.getOrderId())) {
                    throw invalidRow(ordersFile, lineNumber);
                }
                orders.add(order);
            }
        } catch (IOException e) {
            throw loadFailure(ordersFile, e);
        }

        return orders;
    }

    public boolean saveAll(List<User> users, List<Product> products, List<Order> orders) {
        boolean usersSaved = saveUsers(users);
        boolean productsSaved = saveProducts(products);
        boolean ordersSaved = saveOrders(orders);
        return usersSaved && productsSaved && ordersSaved;
    }

    public boolean saveUsers(List<User> users) {
        List<String> lines = new ArrayList<String>();
        for (User user : users) {
            lines.add(user.toCsv());
        }
        return writeAtomically(usersFile, lines);
    }

    public boolean saveProducts(List<Product> products) {
        List<String> lines = new ArrayList<String>();
        for (Product product : products) {
            lines.add(product.toCsv());
        }
        return writeAtomically(productsFile, lines);
    }

    public boolean saveOrders(List<Order> orders) {
        List<String> lines = new ArrayList<String>();
        for (Order order : orders) {
            lines.add(order.toCsv());
        }
        return writeAtomically(ordersFile, lines);
    }

    private boolean writeAtomically(Path target, List<String> lines) {
        Path temporaryFile = null;

        try {
            Files.createDirectories(dataFolder);
            temporaryFile = Files.createTempFile(dataFolder,
                    target.getFileName().toString(), ".tmp");
            Files.write(temporaryFile, lines, StandardCharsets.UTF_8,
                    StandardOpenOption.TRUNCATE_EXISTING);

            try {
                Files.move(temporaryFile, target, StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporaryFile, target, StandardCopyOption.REPLACE_EXISTING);
            }

            return true;
        } catch (IOException e) {
            System.err.println("Could not save " + target + ": " + e.getMessage());
            return false;
        } finally {
            if (temporaryFile != null) {
                try {
                    Files.deleteIfExists(temporaryFile);
                } catch (IOException ignored) {
                    // The temporary file will be overwritten or cleaned up later.
                }
            }
        }
    }

    private boolean fileExists(Path file) {
        if (Files.exists(file)) {
            return true;
        }
        if (Files.notExists(file)) {
            return false;
        }
        throw new IllegalStateException(
                "Could not determine whether data file exists: " + file);
    }

    private IllegalStateException invalidRow(Path file, int lineNumber) {
        return new IllegalStateException("Invalid or duplicate row in " + file
                + " at line " + lineNumber
                + ". The application stopped to protect the original data.");
    }

    private IllegalStateException loadFailure(Path file, IOException e) {
        return new IllegalStateException("Could not load " + file
                + ". The application stopped without overwriting it.", e);
    }
}
