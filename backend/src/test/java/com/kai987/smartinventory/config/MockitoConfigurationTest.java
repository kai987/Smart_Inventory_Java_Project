package com.kai987.smartinventory.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.mockito.MockMakers;
import org.mockito.exceptions.base.MockitoException;

class MockitoConfigurationTest {
    @Test
    void ordinaryMocksUseTheConfiguredNonInstrumentingSubclassMaker() throws Exception {
        assertPluginResource("MockMaker", MockMakers.SUBCLASS);
        assertPluginResource("MemberAccessor", "member-accessor-reflection");

        OrdinaryService service = mock(OrdinaryService.class);
        when(service.message()).thenReturn("mocked");
        assertEquals("mocked", service.message());
        verify(service).message();
        assertThrows(MockitoException.class, () -> mock(FinalService.class));
    }

    private void assertPluginResource(String plugin, String expected) throws IOException {
        try (InputStream resource = getClass().getClassLoader().getResourceAsStream(
                "mockito-extensions/org.mockito.plugins." + plugin)) {
            assertNotNull(resource);
            assertEquals(expected, new String(resource.readAllBytes(), StandardCharsets.UTF_8).strip());
        }
    }

    public static class OrdinaryService {
        public String message() { return "real"; }
    }

    public static final class FinalService { }
}
