public class User {
    private static final String USERNAME_PATTERN = "[A-Za-z0-9_]{3,20}";

    private final String username;
    private final String password;
    private final Role role;

    public User(String username, String password, Role role) {
        if (!isValidUsername(username)) {
            throw new IllegalArgumentException("Username must be 3-20 letters, numbers, or underscores.");
        }
        if (!isValidPassword(password)) {
            throw new IllegalArgumentException("Password is invalid or contains a reserved character.");
        }
        if (role == null) {
            throw new IllegalArgumentException("Role cannot be null.");
        }

        this.username = username;
        this.password = password;
        this.role = role;
    }

    public String getUsername() {
        return username;
    }

    public boolean checkPassword(String password) {
        return this.password.equals(password);
    }

    public Role getRole() {
        return role;
    }

    public boolean isAdmin() {
        return role == Role.ADMIN;
    }

    public String toCsv() {
        return username + "," + password + "," + role;
    }

    public static User fromCsv(String line) {
        String[] parts = line.split(",", -1);

        if (parts.length != 3) {
            return null;
        }

        try {
            String username = parts[0].trim();
            String password = parts[1];
            Role role = Role.valueOf(parts[2].trim());
            return new User(username, password, role);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public static boolean isValidUsername(String username) {
        return username != null && username.matches(USERNAME_PATTERN);
    }

    public static boolean isValidPassword(String password) {
        return password != null
                && password.length() >= 4
                && password.length() <= 100
                && !Product.containsReservedCharacter(password);
    }
}
