package com.kai987.smartinventory;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class SmartInventoryApplication {
    public static void main(String[] args) {
        SpringApplication.run(SmartInventoryApplication.class, args);
    }
}
