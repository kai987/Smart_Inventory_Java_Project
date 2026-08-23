package com.kai987.smartinventory.web;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ApiSecurityIntegrationTest {
    @TempDir
    static Path dataDirectory;

    @DynamicPropertySource
    static void dataProperties(DynamicPropertyRegistry registry) {
        registry.add("app.data-dir", () -> dataDirectory.toString());
    }

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @Test
    @Order(1)
    void getProductsIsPublicAndUsesStringYen() throws Exception {
        mockMvc.perform(get("/api/products?q=lap"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].id").value("P001"))
                .andExpect(jsonPath("$.items[0].priceYen").value("120000"));

        mockMvc.perform(get("/admin/products"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_HTML))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("test-spa")));
    }

    @Test
    @Order(2)
    void loginWithoutCsrfFailsWithJson() throws Exception {
        mockMvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"customer\",\"password\":\"user123\"}"))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("CSRF_INVALID"));
    }

    @Test
    @Order(3)
    void validLoginCreatesSessionAndMeReturnsCurrentUser() throws Exception {
        SessionCsrf initialCsrf = csrf(null);
        MvcResult loginResult = mockMvc.perform(post("/api/auth/login").session(initialCsrf.session())
                        .header(initialCsrf.header(), initialCsrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"customer\",\"password\":\"user123\"}"))
                .andExpect(status().isOk()).andReturn();
        MockHttpSession session = (MockHttpSession) loginResult.getRequest().getSession(false);
        SessionCsrf rotatedCsrf = csrf(session);
        assertNotEquals(initialCsrf.token(), rotatedCsrf.token());

        mockMvc.perform(get("/api/auth/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("customer"))
                .andExpect(jsonPath("$.role").value("CUSTOMER"))
                .andExpect(jsonPath("$.passwordHash").doesNotExist());
        assertFalse(Files.readString(dataDirectory.resolve("users.csv")).contains(",pass1234,"));

        mockMvc.perform(post("/api/orders").session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P002\",\"quantity\":1}]}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_INVALID"));
    }

    @Test
    @Order(4)
    void invalidCredentialsReturnGenericJson401() throws Exception {
        SessionCsrf csrf = csrf(null);
        mockMvc.perform(post("/api/auth/login").session(csrf.session())
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"missing\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"))
                .andExpect(jsonPath("$.message").value("Invalid username or password."));
    }

    @Test
    @Order(5)
    void logoutInvalidatesSession() throws Exception {
        MockHttpSession session = login("customer", "user123");
        SessionCsrf csrf = csrf(session);
        mockMvc.perform(post("/api/auth/logout").session(session)
                        .header(csrf.header(), csrf.token()))
                .andExpect(status().isNoContent())
                .andExpect(cookie().maxAge("JSESSIONID", 0));
        mockMvc.perform(get("/api/auth/me").session(session))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    @Order(6)
    void registerAlwaysCreatesCustomerAndDuplicateIsConflict() throws Exception {
        SessionCsrf csrf = csrf(null);
        mockMvc.perform(post("/api/auth/register").session(csrf.session())
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"new_user\",\"password\":\"pass1234\",\"role\":\"ADMIN\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("CUSTOMER"))
                .andExpect(jsonPath("$.passwordHash").doesNotExist());

        mockMvc.perform(post("/api/auth/register").session(csrf.session())
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"NEW_USER\",\"password\":\"pass1234\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("USERNAME_EXISTS"));
    }

    @Test
    @Order(7)
    void customerCannotCallAdminEndpoint() throws Exception {
        MockHttpSession session = login("customer", "user123");
        mockMvc.perform(get("/api/admin/summary").session(session))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    @Order(8)
    void adminCanCreateUpdateAndDeleteProduct() throws Exception {
        MockHttpSession session = login("admin", "admin123");
        SessionCsrf csrf = csrf(session);
        mockMvc.perform(post("/api/products").session(session)
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"id":"P898","name":"Missing stock","priceYen":"9800","weightKg":0.35}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("stock"));

        mockMvc.perform(post("/api/products").session(session)
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"id":"P899","name":"Null stock","priceYen":"9800","stock":null,"weightKg":0.35}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("stock"));

        mockMvc.perform(post("/api/products").session(session)
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"id":"P901","name":"Overflow","priceYen":"9223372036854775808","stock":1,"weightKg":1.0}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));

        mockMvc.perform(post("/api/products").session(session)
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"id":"P900","name":"Webcam","priceYen":"9800","stock":12,"weightKg":0.35}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.priceYen").value("9800"));

        mockMvc.perform(patch("/api/products/P900/stock").session(session)
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"stock\":20}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stock").value(20));

        mockMvc.perform(delete("/api/products/P900").session(session)
                        .header(csrf.header(), csrf.token()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/products/P900"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PRODUCT_NOT_FOUND"));
    }

    @Test
    @Order(9)
    void customerOrderIgnoresClientAuthorityDecreasesStockAndAppearsOnlyForCustomer() throws Exception {
        MockHttpSession session = login("customer", "user123");
        SessionCsrf csrf = csrf(session);
        mockMvc.perform(post("/api/orders").session(session)
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P002\",\"quantity\":1}]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.customerName").value("customer"))
                .andExpect(jsonPath("$.totalPriceYen").value("2500"));

        mockMvc.perform(get("/api/products/P002"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stock").value(29));
        mockMvc.perform(get("/api/orders/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", greaterThanOrEqualTo(2)))
                .andExpect(jsonPath("$.items[*].customerName", everyItem(is("customer"))));

        mockMvc.perform(post("/api/orders").session(session)
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"customerName\":\"admin\",\"items\":[{\"productId\":\"P002\",\"quantity\":1}]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    @Order(10)
    void insufficientStockReturns409AndChangesNothing() throws Exception {
        MockHttpSession session = login("customer", "user123");
        SessionCsrf csrf = csrf(session);
        int before = productStock("P001");

        mockMvc.perform(post("/api/orders").session(session)
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P001\",\"quantity\":9999}]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INSUFFICIENT_STOCK"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("items[0].quantity"));
        org.junit.jupiter.api.Assertions.assertEquals(before, productStock("P001"));
    }

    @Test
    @Order(11)
    void adminSeesAllOrdersAndSummaryUsesStringInventoryValue() throws Exception {
        MockHttpSession session = login("admin", "admin123");
        mockMvc.perform(get("/api/orders").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", greaterThanOrEqualTo(3)));
        mockMvc.perform(get("/api/admin/summary").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lowStockThreshold").value(5))
                .andExpect(jsonPath("$.inventoryValueYen", not(nullValue())))
                .andExpect(jsonPath("$.customerCount", greaterThanOrEqualTo(4)));
    }

    @Test
    @Order(12)
    void anonymousAndForbiddenSecurityErrorsUseUnifiedJson() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
                .andExpect(jsonPath("$.fieldErrors").isArray());

        MockHttpSession customer = login("customer", "user123");
        mockMvc.perform(get("/api/orders").session(customer))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        mockMvc.perform(get("/api/does-not-exist"))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    private MockHttpSession login(String username, String password) throws Exception {
        SessionCsrf csrf = csrf(null);
        MvcResult result = mockMvc.perform(post("/api/auth/login").session(csrf.session())
                        .header(csrf.header(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginBody(username, password))))
                .andExpect(status().isOk())
                .andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }

    private SessionCsrf csrf(MockHttpSession session) throws Exception {
        var request = get("/api/auth/csrf");
        if (session != null) {
            request.session(session);
        }
        MvcResult result = mockMvc.perform(request).andExpect(status().isOk()).andReturn();
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        return new SessionCsrf((MockHttpSession) result.getRequest().getSession(false),
                body.get("headerName").asText(), body.get("token").asText());
    }

    private int productStock(String id) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/products/" + id))
                .andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("stock").asInt();
    }

    private record SessionCsrf(MockHttpSession session, String header, String token) { }
    private record LoginBody(String username, String password) { }
}
