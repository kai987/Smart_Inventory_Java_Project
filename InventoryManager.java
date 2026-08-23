import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class InventoryManager {
    private List<Product> products;
    private final Map<String, Product> productMap;

    public InventoryManager() {
        products = new ArrayList<Product>();
        productMap = new HashMap<String, Product>();
    }

    public List<Product> getProducts() {
        return Collections.unmodifiableList(products);
    }

    public void setProducts(List<Product> products) {
        if (products == null) {
            throw new IllegalArgumentException("Products cannot be null.");
        }

        List<Product> replacement = new ArrayList<Product>();
        Map<String, Product> replacementMap = new HashMap<String, Product>();

        for (Product product : products) {
            if (product == null || replacementMap.containsKey(product.getId())) {
                throw new IllegalArgumentException("Products contain null or duplicate IDs.");
            }
            replacement.add(product);
            replacementMap.put(product.getId(), product);
        }

        this.products = replacement;
        productMap.clear();
        productMap.putAll(replacementMap);
    }

    public boolean addProduct(Product product) {
        if (product == null || productMap.containsKey(product.getId())) {
            return false;
        }

        products.add(product);
        productMap.put(product.getId(), product);
        return true;
    }

    public Product findProductById(String id) {
        return productMap.get(id);
    }

    public boolean updateStock(String id, int newStock) {
        Product product = findProductById(id);

        if (product == null || newStock < 0) {
            return false;
        }

        product.setStock(newStock);
        return true;
    }

    public boolean removeProduct(String id) {
        Product product = findProductById(id);

        if (product == null) {
            return false;
        }

        products.remove(product);
        productMap.remove(id);
        return true;
    }

    public List<Product> search(String keyword) {
        List<Product> results = new ArrayList<Product>();
        String normalizedKeyword = keyword.toLowerCase(Locale.ROOT);

        for (Product product : products) {
            boolean idMatches = product.getId().toLowerCase(Locale.ROOT)
                    .contains(normalizedKeyword);
            boolean nameMatches = product.getName().toLowerCase(Locale.ROOT)
                    .contains(normalizedKeyword);

            if (idMatches || nameMatches) {
                results.add(product);
            }
        }

        return Collections.unmodifiableList(results);
    }

    public boolean hasAvailableProducts() {
        for (Product product : products) {
            if (product.getStock() > 0) {
                return true;
            }
        }
        return false;
    }

    public void printAllProducts() {
        if (products.isEmpty()) {
            System.out.println("No products available.");
            return;
        }

        System.out.println();
        System.out.println("---------- PRODUCT LIST ----------");

        for (Product product : products) {
            System.out.println(product);
        }
    }
}
