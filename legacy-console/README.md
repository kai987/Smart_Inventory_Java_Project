# Legacy Console Version

This directory preserves the original Object-Oriented Programming course project: a Java console-based Smart Inventory and Packing Management System.

It remains intentionally separate from the Spring Boot and React application. It has its own CSV files under `legacy-console/data/`, does not participate in the Maven build, and does not share runtime data with the web version.

## Run the legacy application

From this directory:

```bash
javac *.java
java Main
```

## Run the legacy regression tests

```bash
javac *.java tests/SmartInventoryTests.java
java -cp .:tests SmartInventoryTests
```

On Windows, use `java -cp .;tests SmartInventoryTests`.
