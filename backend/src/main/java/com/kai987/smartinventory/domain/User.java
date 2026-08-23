package com.kai987.smartinventory.domain;

import java.util.Objects;

public final class User {
    private static final String USERNAME_PATTERN = "[A-Za-z0-9_]{3,20}";

    private final String username;
    private final String passwordHash;
    private final Role role;

    public User(String username, String passwordHash, Role role) {
        if (!isValidUsername(username)) {
            throw new IllegalArgumentException("Username must be 3-20 letters, numbers, or underscores.");
        }
        if (passwordHash == null || passwordHash.isBlank() || passwordHash.contains(",")
                || passwordHash.contains("\n") || passwordHash.contains("\r")) {
            throw new IllegalArgumentException("Password hash is invalid.");
        }
        this.username = username;
        this.passwordHash = passwordHash;
        this.role = Objects.requireNonNull(role, "Role cannot be null.");
    }

    public String getUsername() { return username; }
    public String getPasswordHash() { return passwordHash; }
    public Role getRole() { return role; }

    public String toCsv() {
        return username + "," + passwordHash + "," + role.name();
    }

    public static boolean isValidUsername(String username) {
        return username != null && username.matches(USERNAME_PATTERN);
    }

    public static boolean isValidRawPassword(String password) {
        return password != null && password.length() >= 4 && password.length() <= 100
                && !Product.containsReservedCharacter(password);
    }

    public static boolean isEncodedPassword(String value) {
        return value != null && value.matches("\\{[A-Za-z0-9_-]+}.*");
    }
}
