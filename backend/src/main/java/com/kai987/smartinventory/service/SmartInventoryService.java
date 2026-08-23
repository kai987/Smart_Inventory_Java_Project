package com.kai987.smartinventory.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantReadWriteLock;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.kai987.smartinventory.domain.InventoryManager;
import com.kai987.smartinventory.domain.Order;
import com.kai987.smartinventory.domain.OrderManager;
import com.kai987.smartinventory.domain.Product;
import com.kai987.smartinventory.domain.Role;
import com.kai987.smartinventory.domain.User;
import com.kai987.smartinventory.persistence.CsvFileManager;
import com.kai987.smartinventory.persistence.PersistenceException;
import com.kai987.smartinventory.web.error.DomainException;
import com.kai987.smartinventory.web.error.ErrorCode;

@Service
public class SmartInventoryService {
    private final CsvFileManager files;
    private final PasswordEncoder passwordEncoder;
    private final InventoryManager inventory = new InventoryManager();
    private final OrderManager orders = new OrderManager(inventory);
    private final Map<String, User> users = new LinkedHashMap<>();
    private final ReentrantReadWriteLock stateLock = new ReentrantReadWriteLock(true);

    public SmartInventoryService(CsvFileManager files, PasswordEncoder passwordEncoder) {
        this.files = files;
        this.passwordEncoder = passwordEncoder;
        List<User> loadedUsers = files.loadUsers(passwordEncoder);
        List<Product> loadedProducts = files.loadProducts();
        inventory.setProducts(loadedProducts);
        orders.setOrders(files.loadOrders(inventory));
        loadedUsers.forEach(user -> users.put(normalize(user.getUsername()), user));
    }

    public Optional<User> findUser(String username) {
        stateLock.readLock().lock();
        try {
            return Optional.ofNullable(users.get(normalize(username)));
        } finally {
            stateLock.readLock().unlock();
        }
    }

    public User register(String username, String rawPassword) {
        stateLock.writeLock().lock();
        try {
            if (!User.isValidUsername(username) || !User.isValidRawPassword(rawPassword)) {
                throw new DomainException(ErrorCode.VALIDATION_ERROR);
            }
            String key = normalize(username);
            if (users.containsKey(key)) {
                throw new DomainException(ErrorCode.USERNAME_EXISTS);
            }
            User user = new User(username, passwordEncoder.encode(rawPassword), Role.CUSTOMER);
            users.put(key, user);
            try {
                files.saveUsers(new ArrayList<>(users.values()));
            } catch (PersistenceException exception) {
                users.remove(key);
                throw exception;
            }
            return user;
        } finally {
            stateLock.writeLock().unlock();
        }
    }

    public List<Product> listProducts(String query, boolean inStockOnly) {
        stateLock.readLock().lock();
        try {
            List<Product> source = query == null || query.isBlank()
                    ? inventory.getProducts() : inventory.search(query);
            return source.stream().filter(product -> !inStockOnly || product.getStock() > 0).toList();
        } finally {
            stateLock.readLock().unlock();
        }
    }

    public Product getProduct(String id) {
        stateLock.readLock().lock();
        try {
            Product product = inventory.findProductById(id);
            if (product == null) {
                throw new DomainException(ErrorCode.PRODUCT_NOT_FOUND);
            }
            return product;
        } finally {
            stateLock.readLock().unlock();
        }
    }

    public Product addProduct(String id, String name, String priceYen, int stock,
            double weightKg) {
        stateLock.writeLock().lock();
        try {
            long parsedPrice = parsePrice(priceYen);
            Product product;
            try {
                product = new Product(id, name, parsedPrice, stock, weightKg);
            } catch (IllegalArgumentException exception) {
                throw new DomainException(ErrorCode.VALIDATION_ERROR);
            }
            if (!inventory.addProduct(product)) {
                throw new DomainException(ErrorCode.PRODUCT_EXISTS);
            }
            try {
                files.saveProducts(inventory.getProducts());
            } catch (PersistenceException exception) {
                inventory.removeProduct(id);
                throw exception;
            }
            return inventory.findProductById(id);
        } finally {
            stateLock.writeLock().unlock();
        }
    }

    public Product updateStock(String id, int stock) {
        stateLock.writeLock().lock();
        try {
            Product current = inventory.findProductById(id);
            if (current == null) {
                throw new DomainException(ErrorCode.PRODUCT_NOT_FOUND);
            }
            if (stock < 0) {
                throw new DomainException(ErrorCode.VALIDATION_ERROR);
            }
            int previousStock = current.getStock();
            inventory.updateStock(id, stock);
            try {
                files.saveProducts(inventory.getProducts());
            } catch (PersistenceException exception) {
                inventory.updateStock(id, previousStock);
                throw exception;
            }
            return inventory.findProductById(id);
        } finally {
            stateLock.writeLock().unlock();
        }
    }

    public void deleteProduct(String id) {
        stateLock.writeLock().lock();
        try {
            List<Product> previous = inventory.getProducts();
            if (!inventory.removeProduct(id)) {
                throw new DomainException(ErrorCode.PRODUCT_NOT_FOUND);
            }
            try {
                files.saveProducts(inventory.getProducts());
            } catch (PersistenceException exception) {
                inventory.setProducts(previous);
                throw exception;
            }
        } finally {
            stateLock.writeLock().unlock();
        }
    }

    public Order createOrder(String customerName, List<OrderManager.RequestedItem> requestedItems) {
        stateLock.writeLock().lock();
        try {
            Map<String, Integer> previousStocks = inventory.snapshotStocks();
            Order order = orders.createOrderOrThrow(customerName, requestedItems);
            try {
                files.saveProductsAndOrders(inventory.getProducts(), orders.getOrders());
            } catch (PersistenceException exception) {
                inventory.restoreStocks(previousStocks);
                orders.removeOrder(order.getOrderId());
                throw exception;
            }
            return order;
        } finally {
            stateLock.writeLock().unlock();
        }
    }

    public List<Order> ordersForCustomer(String username) {
        stateLock.readLock().lock();
        try {
            return orders.getOrders().stream()
                    .filter(order -> order.getCustomerName().equalsIgnoreCase(username)).toList();
        } finally {
            stateLock.readLock().unlock();
        }
    }

    public List<Order> allOrders(String customerFilter) {
        stateLock.readLock().lock();
        try {
            if (customerFilter == null || customerFilter.isBlank()) {
                return orders.getOrders();
            }
            return orders.getOrders().stream()
                    .filter(order -> order.getCustomerName().equalsIgnoreCase(customerFilter.trim()))
                    .toList();
        } finally {
            stateLock.readLock().unlock();
        }
    }

    public StateSnapshot snapshot() {
        stateLock.readLock().lock();
        try {
            return new StateSnapshot(inventory.getProducts(), orders.getOrders(),
                    List.copyOf(users.values()));
        } finally {
            stateLock.readLock().unlock();
        }
    }

    private long parsePrice(String value) {
        if (value == null || !value.matches("[1-9]\\d*")) {
            throw new DomainException(ErrorCode.VALIDATION_ERROR, "Price must be a positive integer.");
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException exception) {
            throw new DomainException(ErrorCode.VALIDATION_ERROR, "Price is outside the supported range.");
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }

    public record StateSnapshot(List<Product> products, List<Order> orders, List<User> users) {
        public StateSnapshot {
            products = List.copyOf(products);
            orders = List.copyOf(orders);
            users = List.copyOf(users);
        }
    }
}
