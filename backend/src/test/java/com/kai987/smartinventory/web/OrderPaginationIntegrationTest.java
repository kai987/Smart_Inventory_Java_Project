package com.kai987.smartinventory.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest
@AutoConfigureMockMvc
class OrderPaginationIntegrationTest {
    @TempDir static Path dataDirectory;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) throws Exception {
        List<String> rows = IntStream.range(0, 52)
                .mapToObj(index -> id(index) + "," + (index < 45 ? "customer" : "other_customer")
                        + ",P001:Saved Product:100:0.1:1").toList();
        Files.write(dataDirectory.resolve("orders.csv"), rows);
        registry.add("app.data-dir", dataDirectory::toString);
    }

    @Autowired MockMvc mvc;
    @Autowired JsonMapper mapper;

    @Test
    void customerPagesPreserveLegacyOrderOverallTotalAndPrivateScope() throws Exception {
        assertPage(customer("/api/orders/me"), 45, ids(0, 45));
        assertPage(customer("/api/orders/me?unknown=ignored"), 45, ids(0, 45));
        assertPage(customer("/api/orders/me?page=2"), 45, ids(20, 40));
        assertPage(customer("/api/orders/me?page=3"), 45, ids(40, 45));
        assertPage(customer("/api/orders/me?size=2"), 45, ids(0, 2));
        assertPage(customer("/api/orders/me?sort=desc"), 45, ids(25, 45).reversed());
        assertPage(customer("/api/orders/me?page=01&size=020&sort=asc"), 45, ids(0, 20));
        assertPage(customer("/api/orders/me?page=1000000&size=100"), 45, List.of());
        // A supplied customer parameter must never widen the authenticated scope.
        assertPage(customer("/api/orders/me?customer=other_customer&page=2"), 45, ids(20, 40));
    }

    @Test
    void adminFiltersAreAppliedBeforePagingAndDescendingReversesTheLegacyOrder() throws Exception {
        assertPage(admin("/api/orders"), 52, ids(0, 52));
        assertPage(admin("/api/orders?sort=asc"), 52, ids(0, 20));
        assertPage(admin("/api/orders?sort=desc"), 52, ids(32, 52).reversed());
        assertPage(admin("/api/orders?size=100").param("customer", " CUSTOMER "), 45, ids(0, 45));
        assertPage(admin("/api/orders?customer=other_customer"), 7, ids(45, 52));
        assertPage(admin("/api/orders?customer=other_customer&page=2&size=3&sort=desc"),
                7, ids(46, 49).reversed());
        assertPage(admin("/api/orders?customer=nobody&page=1"), 0, List.of());
    }

    @Test
    void malformedPaginationAlwaysUsesTheStructuredValidationContract() throws Exception {
        for (String query : List.of("page=", "size=", "sort=", "page=0", "page=1000001",
                "size=0", "size=101", "page=-1", "page=%2B1", "page=1.0", "page=1e2",
                "page=%201", "page=999999999999999999999999999999999999", "size=one",
                "sort=ASC", "sort=newest", "page=1&page=2", "size=1&size=1", "sort=asc&sort=desc")) {
            mvc.perform(customer("/api/orders/me?" + query)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.status").value(400))
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                    .andExpect(jsonPath("$.path").value("/api/orders/me"))
                    .andExpect(jsonPath("$.fieldErrors").isArray());
            mvc.perform(admin("/api/orders?" + query)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
    }

    @Test
    void paginationCannotBypassAuthenticationOrRoleBoundaries() throws Exception {
        mvc.perform(get("/api/orders/me?page=0")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/orders?page=1")).andExpect(status().isUnauthorized());
        mvc.perform(customer("/api/orders?page=1")).andExpect(status().isForbidden());
        mvc.perform(admin("/api/orders/me?page=1")).andExpect(status().isForbidden());
    }

    private void assertPage(MockHttpServletRequestBuilder request, int total, List<String> expected) throws Exception {
        String json = mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode body = mapper.readTree(json);
        assertEquals(total, body.get("total").intValue());
        List<String> actual = new ArrayList<>();
        for (JsonNode item : body.get("items")) actual.add(item.get("orderId").asText());
        assertEquals(expected, actual);
    }

    private static MockHttpServletRequestBuilder customer(String path) {
        return get(path).with(user("customer").roles("CUSTOMER"));
    }

    private static MockHttpServletRequestBuilder admin(String path) {
        return get(path).with(user("admin").roles("ADMIN"));
    }

    private static String id(int value) { return "O%03d".formatted(value); }
    private static List<String> ids(int start, int end) { return IntStream.range(start, end).mapToObj(OrderPaginationIntegrationTest::id).toList(); }
}
