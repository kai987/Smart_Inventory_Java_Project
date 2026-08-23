public class Main {
    public static void main(String[] args) {
        try {
            App app = new App();
            app.start();
        } catch (IllegalStateException e) {
            System.err.println("Application could not start: " + e.getMessage());
        }
    }
}
