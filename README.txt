Smart Inventory and Packing Management System

Requirements:
- Java 8 or later
- Run commands from the project root so the data folder can be found.

How to compile:
javac *.java

How to run:
java Main

How to run the automated regression tests:
javac *.java tests/SmartInventoryTests.java
java -cp .:tests SmartInventoryTests

On Windows, use this test command instead:
java -cp .;tests SmartInventoryTests

Default accounts:
Admin:
username: admin
password: admin123

Customer:
username: customer
password: user123

Main features:
1. Login with two roles: ADMIN and CUSTOMER.
2. First-time customers can register an account from the main menu.
3. Admin can add, remove, update and fuzzy-search products by ID or name.
4. Customer can view products and create orders.
5. Orders validate the combined quantity of duplicate products before reducing stock.
6. Historical order items keep a snapshot of product name, price and weight.
7. Orders estimate the number of boxes based on total weight.
8. UTF-8 data is saved automatically; each CSV file is replaced atomically.

Input and data rules:
- Usernames must contain 3-20 ASCII letters, numbers or underscores.
- Product IDs must use P followed by three digits, for example P001.
- CSV-reserved comma, pipe and colon characters are rejected in user-entered fields.
- Product prices are stored as whole yen using long integers.
- Customer registration and product addition accept 0 to cancel before saving.
- A stock value of 0 remains valid; product addition has a separate final confirmation.
- Existing product prices such as 120000.0 and legacy order items such as P001:2
  remain readable and are migrated when data is next saved.
- Default users and products are initialized only when their CSV files do not exist.
- If an existing CSV file cannot be read or contains an invalid or duplicate row,
  startup stops without overwriting the original data.

Security note:
Passwords are stored as plain text only for this classroom demonstration.
This authentication design must not be used for a production system.

Course concepts used:
- Fundamentals, data types and operators
- Control statements and loops
- Arrays / Collections
- Methods, classes and objects
- Encapsulation and composition
- Enum
- Regular-expression validation
- UTF-8 file input/output
- Exception handling
- Defensive copies and unmodifiable collection views
- Automated business-rule regression tests
