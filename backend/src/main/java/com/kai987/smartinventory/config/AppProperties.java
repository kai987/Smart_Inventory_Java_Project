package com.kai987.smartinventory.config;

import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private Path dataDir = Path.of("./runtime-data");
    private int lowStockThreshold = 5;
    private String allowedOrigins = "http://localhost:5173";

    public Path getDataDir() {
        return dataDir;
    }

    public void setDataDir(Path dataDir) {
        this.dataDir = dataDir;
    }

    public int getLowStockThreshold() {
        return lowStockThreshold;
    }

    public void setLowStockThreshold(int lowStockThreshold) {
        if (lowStockThreshold < 0) {
            throw new IllegalArgumentException("Low-stock threshold cannot be negative.");
        }
        this.lowStockThreshold = lowStockThreshold;
    }

    public String getAllowedOrigins() {
        return allowedOrigins;
    }

    public void setAllowedOrigins(String allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
    }

    public List<String> allowedOriginList() {
        List<String> origins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .distinct()
                .toList();
        if (origins.isEmpty() || origins.contains("*")) {
            throw new IllegalArgumentException(
                    "Credentialed CORS requires at least one explicit allowed origin.");
        }
        return origins;
    }
}
