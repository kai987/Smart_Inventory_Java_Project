import java.util.Scanner;

public class InputHelper {
    private final Scanner scanner;

    public InputHelper() {
        scanner = new Scanner(System.in);
    }

    public String readString(String message) {
        System.out.print(message);
        return scanner.nextLine().trim();
    }

    public String readNonEmptyString(String message, String errorMessage) {
        while (true) {
            String value = readString(message);

            if (!value.isEmpty()) {
                return value;
            }

            System.out.println(errorMessage);
        }
    }

    public int readInt(String message) {
        while (true) {
            System.out.print(message);

            try {
                String text = scanner.nextLine().trim();
                return Integer.parseInt(text);
            } catch (NumberFormatException e) {
                System.out.println("Please enter a valid integer.");
            }
        }
    }

    public int readIntInRange(String message, int min, int max) {
        while (true) {
            int value = readInt(message);

            if (value >= min && value <= max) {
                return value;
            }

            System.out.println("Please enter a number from " + min + " to " + max + ".");
        }
    }

    public int readIntAtLeast(String message, int min, String errorMessage) {
        while (true) {
            int value = readInt(message);

            if (value >= min) {
                return value;
            }

            System.out.println(errorMessage);
        }
    }

    public long readLong(String message) {
        while (true) {
            System.out.print(message);

            try {
                String text = scanner.nextLine().trim();
                return Long.parseLong(text);
            } catch (NumberFormatException e) {
                System.out.println("Please enter a valid whole number.");
            }
        }
    }

    public long readLongAtLeast(String message, long min, String errorMessage) {
        while (true) {
            long value = readLong(message);

            if (value >= min) {
                return value;
            }

            System.out.println(errorMessage);
        }
    }

    public double readDouble(String message) {
        while (true) {
            System.out.print(message);

            try {
                String text = scanner.nextLine().trim();
                return Double.parseDouble(text);
            } catch (NumberFormatException e) {
                System.out.println("Please enter a valid number.");
            }
        }
    }

    public double readPositiveDouble(String message, String errorMessage) {
        while (true) {
            double value = readDouble(message);

            if (Product.isPositiveFinite(value)) {
                return value;
            }

            System.out.println(errorMessage);
        }
    }

    public boolean readYesNo(String message) {
        while (true) {
            String answer = readString(message);

            if (answer.equalsIgnoreCase("y")) {
                return true;
            }

            if (answer.equalsIgnoreCase("n")) {
                return false;
            }

            System.out.println("Please enter y or n.");
        }
    }

    public void close() {
        scanner.close();
    }
}
