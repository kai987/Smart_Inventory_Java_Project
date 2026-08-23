import java.util.ArrayList;
import java.util.List;

public class App {
    private final InputHelper inputHelper;
    private final FileManager fileManager;
    private final InventoryManager inventoryManager;
    private final OrderManager orderManager;
    private List<User> users;
    private User currentUser;

    public App() {
        inputHelper = new InputHelper();
        fileManager = new FileManager();
        inventoryManager = new InventoryManager();
        orderManager = new OrderManager(inventoryManager);
        users = new ArrayList<User>();
    }

    public void start() {
        loadData();

        boolean running = true;
        while (running) {
            System.out.println();
            System.out.println("======================================");
            System.out.println(" SMART INVENTORY AND PACKING SYSTEM");
            System.out.println("======================================");
            System.out.println("1. Login");
            System.out.println("2. Register as customer");
            System.out.println("3. Show products");
            System.out.println("0. Exit");

            int choice = inputHelper.readIntInRange("Choose menu: ", 0, 3);

            switch (choice) {
                case 1:
                    login();
                    break;
                case 2:
                    registerCustomer();
                    break;
                case 3:
                    inventoryManager.printAllProducts();
                    break;
                case 0:
                    if (saveData()) {
                        System.out.println("Data saved. Goodbye!");
                    } else {
                        System.out.println("Warning: Some data could not be saved. Goodbye!");
                    }
                    running = false;
                    break;
                default:
                    System.out.println("Invalid menu choice.");
                    break;
            }
        }

        inputHelper.close();
    }

    private void loadData() {
        boolean usersFileExists = fileManager.usersFileExists();
        boolean productsFileExists = fileManager.productsFileExists();

        users = new ArrayList<User>(fileManager.loadUsers());
        inventoryManager.setProducts(fileManager.loadProducts());

        if (!usersFileExists) {
            users.add(new User("admin", "admin123", Role.ADMIN));
            users.add(new User("customer", "user123", Role.CUSTOMER));
        } else if (users.isEmpty()) {
            throw new IllegalStateException(
                    "data/users.csv exists but contains no users. "
                            + "Restore the file or delete it to initialize default accounts.");
        }

        if (!productsFileExists) {
            inventoryManager.addProduct(new Product("P001", "Laptop", 120000L, 8, 3.0));
            inventoryManager.addProduct(new Product("P002", "Mouse", 2500L, 30, 0.2));
            inventoryManager.addProduct(new Product("P003", "Keyboard", 7000L, 15, 0.8));
            inventoryManager.addProduct(new Product("P004", "Monitor", 35000L, 6, 5.0));
        }

        orderManager.setOrders(fileManager.loadOrders(inventoryManager));
    }

    private boolean saveData() {
        return fileManager.saveAll(users, inventoryManager.getProducts(), orderManager.getOrders());
    }

    private void login() {
        System.out.println();
        System.out.println("---------- SELECT USERNAME ----------");

        for (int i = 0; i < users.size(); i++) {
            System.out.println((i + 1) + ". " + users.get(i).getUsername());
        }

        int userChoice = inputHelper.readIntInRange(
                "Choose username: ", 1, users.size());
        User user = users.get(userChoice - 1);

        while (true) {
            String password = inputHelper.readNonEmptyString(
                    "Password: ", "Password cannot be empty.");

            if (user.checkPassword(password)) {
                break;
            }

            System.out.println("Incorrect password.");
            System.out.println("1. Enter password again");
            System.out.println("0. Return to main menu");

            int retryChoice = inputHelper.readIntInRange(
                    "Choose option: ", 0, 1);

            if (retryChoice == 0) {
                return;
            }
        }

        currentUser = user;
        System.out.println("Login successful. Welcome, " + currentUser.getUsername() + "!");
        if (currentUser.isAdmin()) {
            adminMenu();
        } else {
            customerMenu();
        }
        currentUser = null;
    }

    private void registerCustomer() {
        System.out.println();
        System.out.println("---------- CUSTOMER REGISTRATION ----------");

        String username;

        while (true) {
            username = inputHelper.readNonEmptyString(
                    "New username (0 to cancel): ", "Username cannot be empty.");

            if (username.equals("0")) {
                System.out.println("Registration cancelled.");
                return;
            } else if (!User.isValidUsername(username)) {
                System.out.println("Username must be 3-20 letters, numbers, or underscores.");
            } else if (usernameExists(username)) {
                System.out.println("This username already exists.");
            } else {
                break;
            }
        }

        String password;

        while (true) {
            password = inputHelper.readNonEmptyString(
                    "New password (0 to cancel): ", "Password cannot be empty.");

            if (password.equals("0")) {
                System.out.println("Registration cancelled.");
                return;
            }

            if (User.isValidPassword(password)) {
                break;
            }

            System.out.println("Password must be 4-100 characters and cannot contain comma, pipe or colon.");
        }

        int confirmation = inputHelper.readIntInRange(
                "Confirm registration? (1 = confirm, 0 = cancel): ", 0, 1);
        if (confirmation == 0) {
            System.out.println("Registration cancelled.");
            return;
        }

        User newUser = new User(username, password, Role.CUSTOMER);
        users.add(newUser);

        if (saveData()) {
            System.out.println("Registration successful. You can login now.");
        } else {
            System.out.println("Registration succeeded for this session, but data could not be saved.");
        }
    }

    private boolean usernameExists(String username) {
        for (User user : users) {
            if (user.getUsername().equalsIgnoreCase(username)) {
                return true;
            }
        }

        return false;
    }

    private void adminMenu() {
        boolean running = true;

        while (running) {
            System.out.println();
            System.out.println("---------- ADMIN MENU ----------");
            System.out.println("1. Show all products");
            System.out.println("2. Add product");
            System.out.println("3. Update product stock");
            System.out.println("4. Remove product");
            System.out.println("5. Show all orders");
            System.out.println("6. Search product by ID or name");
            System.out.println("7. Save data");
            System.out.println("0. Logout");

            int choice = inputHelper.readIntInRange("Choose menu: ", 0, 7);

            switch (choice) {
                case 1:
                    inventoryManager.printAllProducts();
                    break;
                case 2:
                    addProduct();
                    break;
                case 3:
                    updateStock();
                    break;
                case 4:
                    removeProduct();
                    break;
                case 5:
                    orderManager.printAllOrders();
                    break;
                case 6:
                    searchProduct();
                    break;
                case 7:
                    printSaveResult();
                    break;
                case 0:
                    printSaveResult();
                    running = false;
                    System.out.println("Logged out.");
                    break;
                default:
                    System.out.println("Invalid menu choice.");
                    break;
            }
        }
    }

    private void customerMenu() {
        boolean running = true;

        while (running) {
            System.out.println();
            System.out.println("---------- CUSTOMER MENU ----------");
            System.out.println("1. Show products");
            System.out.println("2. Create order");
            System.out.println("3. Show my orders");
            System.out.println("0. Logout");

            int choice = inputHelper.readIntInRange("Choose menu: ", 0, 3);

            switch (choice) {
                case 1:
                    inventoryManager.printAllProducts();
                    break;
                case 2:
                    createOrder();
                    break;
                case 3:
                    orderManager.printOrdersByCustomer(currentUser.getUsername());
                    break;
                case 0:
                    printSaveResult();
                    running = false;
                    System.out.println("Logged out.");
                    break;
                default:
                    System.out.println("Invalid menu choice.");
                    break;
            }
        }
    }

    private void addProduct() {
        String id;

        while (true) {
            id = inputHelper.readNonEmptyString(
                    "Product ID (P followed by three digits, 0 to cancel): ",
                    "Product ID cannot be empty.");

            if (id.equals("0")) {
                System.out.println("Product addition cancelled.");
                return;
            } else if (!Product.isValidId(id)) {
                System.out.println("Product ID must use the format P followed by three digits, for example P005.");
            } else if (inventoryManager.findProductById(id) != null) {
                System.out.println("Product ID already exists.");
            } else {
                break;
            }
        }

        String name;
        while (true) {
            name = inputHelper.readNonEmptyString(
                    "Product name (0 to cancel): ", "Product name cannot be empty.");
            if (name.equals("0")) {
                System.out.println("Product addition cancelled.");
                return;
            }
            if (Product.isValidName(name)) {
                break;
            }
            System.out.println("Product name cannot contain comma, pipe or colon.");
        }

        long priceYen;
        while (true) {
            priceYen = inputHelper.readLong("Price in yen (0 to cancel): ");
            if (priceYen == 0L) {
                System.out.println("Product addition cancelled.");
                return;
            }
            if (priceYen > 0L) {
                break;
            }
            System.out.println("Price must be positive.");
        }

        int stock = inputHelper.readIntAtLeast(
                "Stock (0 is allowed): ", 0, "Stock cannot be negative.");

        double weight;
        while (true) {
            weight = inputHelper.readDouble("Weight in kg (0 to cancel): ");
            if (weight == 0.0) {
                System.out.println("Product addition cancelled.");
                return;
            }
            if (Product.isPositiveFinite(weight)) {
                break;
            }
            System.out.println("Weight must be positive.");
        }

        int confirmation = inputHelper.readIntInRange(
                "Confirm add product? (1 = confirm, 0 = cancel): ", 0, 1);
        if (confirmation == 0) {
            System.out.println("Product addition cancelled.");
            return;
        }

        Product product = new Product(id, name, priceYen, stock, weight);
        if (inventoryManager.addProduct(product)) {
            saveAfterChange("Product added.");
        } else {
            System.out.println("Product could not be added.");
        }
    }

    private void updateStock() {
        if (inventoryManager.getProducts().isEmpty()) {
            System.out.println("No products available.");
            return;
        }

        inventoryManager.printAllProducts();

        while (true) {
            String id = inputHelper.readNonEmptyString(
                    "Product ID (0 to cancel): ", "Product ID cannot be empty.");

            if (id.equals("0")) {
                System.out.println("Stock update cancelled.");
                return;
            }

            if (!Product.isValidId(id)) {
                System.out.println("Product ID must use the format P followed by three digits.");
                continue;
            }

            if (inventoryManager.findProductById(id) == null) {
                System.out.println("Product not found.");
                continue;
            }

            int newStock = inputHelper.readIntAtLeast(
                    "New stock: ", 0, "Stock cannot be negative.");

            if (inventoryManager.updateStock(id, newStock)) {
                saveAfterChange("Stock updated.");
            }
            return;
        }
    }

    private void removeProduct() {
        if (inventoryManager.getProducts().isEmpty()) {
            System.out.println("No products available.");
            return;
        }

        inventoryManager.printAllProducts();

        while (true) {
            String id = inputHelper.readNonEmptyString(
                    "Product ID (0 to cancel): ", "Product ID cannot be empty.");

            if (id.equals("0")) {
                System.out.println("Product removal cancelled.");
                return;
            }

            if (!Product.isValidId(id)) {
                System.out.println("Product ID must use the format P followed by three digits.");
                continue;
            }

            if (inventoryManager.removeProduct(id)) {
                saveAfterChange("Product removed. Historical orders keep their product snapshots.");
                return;
            }

            System.out.println("Product not found.");
        }
    }

    private void searchProduct() {
        System.out.println("Enter 0 to cancel search.");

        while (true) {
            String keyword = inputHelper.readNonEmptyString(
                    "Search keyword: ", "Search keyword cannot be empty.");

            if (keyword.equals("0")) {
                System.out.println("Search cancelled.");
                return;
            }

            List<Product> results = inventoryManager.search(keyword);

            if (results.isEmpty()) {
                System.out.println("No products found. Please try again.");
                continue;
            }

            System.out.println("---------- SEARCH RESULTS ----------");
            for (Product product : results) {
                System.out.println(product);
            }
            return;
        }
    }

    private void createOrder() {
        if (!inventoryManager.hasAvailableProducts()) {
            System.out.println("No products are currently in stock.");
            return;
        }

        List<OrderItem> items = new ArrayList<OrderItem>();
        boolean adding = true;

        while (adding) {
            inventoryManager.printAllProducts();

            String productId = inputHelper.readNonEmptyString(
                    "Enter product ID to buy (0 to finish/cancel): ",
                    "Product ID cannot be empty.");

            if (productId.equals("0")) {
                break;
            }
            if (!Product.isValidId(productId)) {
                System.out.println("Product ID must use the format P followed by three digits.");
                continue;
            }

            Product product = inventoryManager.findProductById(productId);
            if (product == null) {
                System.out.println("Product not found.");
                continue;
            }

            int availableQuantity = product.getStock() - getRequestedQuantity(items, productId);
            if (availableQuantity <= 0) {
                System.out.println("No more units of this product are available for this order.");
                continue;
            }

            int quantity;
            while (true) {
                quantity = inputHelper.readIntAtLeast(
                        "Quantity: ", 1, "Quantity must be positive.");

                if (quantity <= availableQuantity) {
                    break;
                }

                System.out.println("Not enough stock. Remaining available quantity: "
                        + availableQuantity + ".");
            }

            items.add(new OrderItem(product, quantity));
            adding = inputHelper.readYesNo("Add another item? (y/n): ");
        }

        if (items.isEmpty()) {
            System.out.println("Order cancelled because there are no items.");
            return;
        }

        Order order = orderManager.createOrder(currentUser.getUsername(), items);
        if (order == null) {
            System.out.println("Order could not be created because the order is invalid or stock changed.");
            return;
        }

        saveAfterChange("Order created successfully.");
        System.out.println(order);
    }

    private int getRequestedQuantity(List<OrderItem> items, String productId) {
        int total = 0;
        for (OrderItem item : items) {
            if (item.getProductId().equals(productId)) {
                total += item.getQuantity();
            }
        }
        return total;
    }

    private void saveAfterChange(String successMessage) {
        if (saveData()) {
            System.out.println(successMessage + " Data saved.");
        } else {
            System.out.println(successMessage + " Warning: data could not be saved.");
        }
    }

    private void printSaveResult() {
        if (saveData()) {
            System.out.println("Data saved.");
        } else {
            System.out.println("Warning: Some data could not be saved.");
        }
    }
}
