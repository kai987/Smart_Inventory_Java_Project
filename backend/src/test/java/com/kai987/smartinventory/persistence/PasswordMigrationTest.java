package com.kai987.smartinventory.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.kai987.smartinventory.domain.User;

class PasswordMigrationTest {
    @TempDir
    Path tempDirectory;

    private final PasswordEncoder encoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();

    @Test
    void plaintextPasswordLoadsMigratesAndStillAuthenticates() throws Exception {
        Path usersFile = tempDirectory.resolve("users.csv");
        Files.writeString(usersFile, "alice,pass123,CUSTOMER\n", StandardCharsets.UTF_8);

        List<User> users = new CsvFileManager(tempDirectory).loadUsers(encoder);
        String migrated = users.getFirst().getPasswordHash();

        assertTrue(migrated.startsWith("{bcrypt}"));
        assertTrue(encoder.matches("pass123", migrated));
        assertTrue(Files.readString(usersFile).contains("{bcrypt}"));
    }

    @Test
    void encodedPasswordIsNotEncodedTwice() throws Exception {
        String encoded = encoder.encode("pass123");
        Path usersFile = tempDirectory.resolve("users.csv");
        Files.writeString(usersFile, "alice," + encoded + ",CUSTOMER\n");

        List<User> users = new CsvFileManager(tempDirectory).loadUsers(encoder);

        assertEquals(encoded, users.getFirst().getPasswordHash());
        assertEquals("alice," + encoded + ",CUSTOMER\n", Files.readString(usersFile));
    }

    @Test
    void malformedUserPreventsMigrationAndPreservesEntireFile() throws Exception {
        Path usersFile = tempDirectory.resolve("users.csv");
        List<String> original = List.of("alice,pass123,CUSTOMER", "broken,row");
        Files.write(usersFile, original, StandardCharsets.UTF_8);

        assertThrows(PersistenceException.class,
                () -> new CsvFileManager(tempDirectory).loadUsers(encoder));
        assertEquals(original, Files.readAllLines(usersFile, StandardCharsets.UTF_8));
    }
}
