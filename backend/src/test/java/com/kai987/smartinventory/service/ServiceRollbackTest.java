package com.kai987.smartinventory.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.kai987.smartinventory.domain.InventoryManager;
import com.kai987.smartinventory.domain.Order;
import com.kai987.smartinventory.domain.OrderManager;
import com.kai987.smartinventory.domain.Product;
import com.kai987.smartinventory.domain.Role;
import com.kai987.smartinventory.domain.User;
import com.kai987.smartinventory.persistence.CsvFileManager;
import com.kai987.smartinventory.persistence.PersistenceException;

class ServiceRollbackTest {
    @TempDir
    Path tempDirectory;

    @Test
    void stockUpdateRollsBackWhenPersistenceFails() {
        PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();
        FailingCsvFiles files = new FailingCsvFiles(tempDirectory, encoder);
        SmartInventoryService service = new SmartInventoryService(files, encoder);

        assertThrows(PersistenceException.class, () -> service.updateStock("P001", 99));
        assertEquals(5, service.getProduct("P001").getStock());
    }

    @Test
    void orderStockAndOrderListRollBackWhenMultiFileSaveFails() {
        PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();
        FailingCsvFiles files = new FailingCsvFiles(tempDirectory, encoder);
        SmartInventoryService service = new SmartInventoryService(files, encoder);

        assertThrows(PersistenceException.class, () -> service.createOrder("alice",
                List.of(new OrderManager.RequestedItem("P001", 2))));
        assertEquals(5, service.getProduct("P001").getStock());
        assertTrue(service.allOrders(null).isEmpty());
    }

    private static final class FailingCsvFiles extends CsvFileManager {
        private final User user;

        private FailingCsvFiles(Path directory, PasswordEncoder encoder) {
            super(directory);
            user = new User("alice", encoder.encode("pass123"), Role.CUSTOMER);
        }

        @Override
        public List<User> loadUsers(PasswordEncoder encoder) {
            return List.of(user);
        }

        @Override
        public List<Product> loadProducts() {
            return List.of(new Product("P001", "Laptop", 1000L, 5, 1.0));
        }

        @Override
        public List<Order> loadOrders(InventoryManager inventoryManager) {
            return List.of();
        }

        @Override
        public void saveProducts(List<Product> products) {
            throw new PersistenceException("simulated");
        }

        @Override
        public void saveProductsAndOrders(List<Product> products, List<Order> orders) {
            throw new PersistenceException("simulated");
        }
    }
}
