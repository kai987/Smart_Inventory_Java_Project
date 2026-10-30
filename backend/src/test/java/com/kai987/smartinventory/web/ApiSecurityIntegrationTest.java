package com.kai987.smartinventory.web;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

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

    @Test
    @Order(13)
    void keyedOrderReplayReturnsOriginalOrderWithoutDeductingStockAgain() throws Exception {
        MockHttpSession session = login("customer", "user123");
        SessionCsrf csrf = csrf(session);
        int beforeStock = productStock("P002");
        int beforeOrders = customerOrderCount(session);
        String key = "http_replay_1234567890";

        MvcResult created = mockMvc.perform(post("/api/orders").session(session)
                        .header(csrf.header(), csrf.token())
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P002\",\"quantity\":2}]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.customerName").value("customer"))
                .andReturn();
        JsonNode original = objectMapper.readTree(created.getResponse().getContentAsString());

        MvcResult replayed = mockMvc.perform(post("/api/orders").session(session)
                        .header(csrf.header(), csrf.token())
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P002\",\"quantity\":1},{\"productId\":\"P002\",\"quantity\":1}]}"))
                .andExpect(status().isCreated())
                .andReturn();

        assertEquals(original, objectMapper.readTree(replayed.getResponse().getContentAsString()));
        assertEquals(beforeStock - 2, productStock("P002"));
        assertEquals(beforeOrders + 1, customerOrderCount(session));
    }

    @Test
    @Order(14)
    void keyedOrderChangedIntentReturnsConflictAndPreservesOriginalOrder() throws Exception {
        MockHttpSession session = login("customer", "user123");
        SessionCsrf csrf = csrf(session);
        int beforeStock = productStock("P002");
        int beforeOrders = customerOrderCount(session);
        String key = "http_conflict_1234567890";

        mockMvc.perform(post("/api/orders").session(session)
                        .header(csrf.header(), csrf.token())
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P002\",\"quantity\":1}]}"))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/orders").session(session)
                        .header(csrf.header(), csrf.token())
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P002\",\"quantity\":2}]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        assertEquals(beforeStock - 1, productStock("P002"));
        assertEquals(beforeOrders + 1, customerOrderCount(session));
    }

    @Test
    @Order(15)
    void malformedIdempotencyKeysReturnValidationErrorWithoutCreatingOrders() throws Exception {
        MockHttpSession session = login("customer", "user123");
        SessionCsrf csrf = csrf(session);
        int beforeStock = productStock("P002");
        int beforeOrders = customerOrderCount(session);

        for (String key : new String[]{"short", "checkout/1234567890", "a".repeat(129)}) {
            mockMvc.perform(post("/api/orders").session(session)
                            .header(csrf.header(), csrf.token())
                            .header("Idempotency-Key", key)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"items\":[{\"productId\":\"P002\",\"quantity\":1}]}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }

        assertEquals(beforeStock, productStock("P002"));
        assertEquals(beforeOrders, customerOrderCount(session));
    }

    @Test
    @Order(16)
    void loginAccepts72BytePasswordButNeverMatchesIts73BytePrefix() throws Exception {
        assertPasswordByteLimitAtLogin("password_ascii", "a".repeat(72), "a".repeat(73));
    }

    @Test
    @Order(17)
    void loginUsesUtf8BytesForMultibytePasswordLimit() throws Exception {
        assertPasswordByteLimitAtLogin("password_utf8", "中".repeat(24), "中".repeat(25));
    }

    private void assertPasswordByteLimitAtLogin(String username, String validPassword,
            String tooLongPassword) throws Exception {
        SessionCsrf registrationCsrf = csrf(null);
        mockMvc.perform(post("/api/auth/register").session(registrationCsrf.session())
                        .header(registrationCsrf.header(), registrationCsrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginBody(username, validPassword))))
                .andExpect(status().isCreated());

        MockHttpSession successfulSession = login(username, validPassword);
        mockMvc.perform(get("/api/auth/me").session(successfulSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value(username));

        SessionCsrf rejectedCsrf = csrf(null);
        mockMvc.perform(post("/api/auth/login").session(rejectedCsrf.session())
                        .header(rejectedCsrf.header(), rejectedCsrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginBody(username, tooLongPassword))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
        mockMvc.perform(get("/api/auth/me").session(rejectedCsrf.session()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @Order(30)
    void multilingualCustomNamesRequireAdminAndPersistOrderSnapshots() throws Exception {
        MockHttpSession admin = login("admin", "admin123");
        SessionCsrf adminCsrf = csrf(admin);
        String path = "/api/products/P900/names";
        mockMvc.perform(post("/api/products").session(admin)
                        .header(adminCsrf.header(), adminCsrf.token()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"P900\",\"name\":\"Travel Cup\",\"nameJa\":\" トラベルカップ \",\"nameZh\":\"旅行杯\",\"priceYen\":\"1200\",\"stock\":4,\"weightKg\":0.3}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.nameJa").value("トラベルカップ"));
        mockMvc.perform(get("/api/products").param("q", "旅行"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].id").value("P900"));
        MockHttpSession customer = login("customer", "user123");
        SessionCsrf customerCsrf = csrf(customer);
        mockMvc.perform(patch(path).session(customer)
                        .header(customerCsrf.header(), customerCsrf.token()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Cup\"}"))
                .andExpect(status().isForbidden());
        MvcResult placed = mockMvc.perform(post("/api/orders").session(customer)
                        .header(customerCsrf.header(), customerCsrf.token()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P900\",\"quantity\":1}]}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.items[0].productNameZh").value("旅行杯")).andReturn();
        String orderId = objectMapper.readTree(placed.getResponse().getContentAsString()).get("orderId").asText();
        mockMvc.perform(patch(path).session(admin).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"New Cup\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CSRF_INVALID"));
        for (String invalidName : List.of("123", "true")) {
            mockMvc.perform(post("/api/products").session(admin).header(adminCsrf.header(), adminCsrf.token())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"id\":\"P901\",\"name\":" + invalidName + ",\"priceYen\":\"1200\",\"stock\":4,\"weightKg\":0.3}"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
            mockMvc.perform(patch(path).session(admin).header(adminCsrf.header(), adminCsrf.token())
                            .contentType(MediaType.APPLICATION_JSON).content("{\"name\":" + invalidName + "}"))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        mockMvc.perform(get("/api/products/P901")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/products/P900")).andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Travel Cup"));
        for (String invalid : List.of("{\"name\":\"Bad\",\"nameJa\":123}", "{\"name\":\"Bad\",\"nameZh\":\"bad:name\"}",
                "{\"name\":\"Bad\",\"nameJa\":\"" + "日".repeat(101) + "\"}", "{\"name\":\" \"}")) {
            mockMvc.perform(patch(path).session(admin).header(adminCsrf.header(), adminCsrf.token())
                            .contentType(MediaType.APPLICATION_JSON).content(invalid))
                    .andExpect(status().isBadRequest());
        }
        mockMvc.perform(patch(path).session(admin).header(adminCsrf.header(), adminCsrf.token())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"New Cup\",\"nameJa\":\" \",\"nameZh\":null}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.nameJa").doesNotExist())
                .andExpect(jsonPath("$.nameZh").doesNotExist()).andExpect(jsonPath("$.stock").value(3));
        mockMvc.perform(delete("/api/products/P900").session(admin).header(adminCsrf.header(), adminCsrf.token()))
                .andExpect(status().isNoContent());
        MvcResult saved = mockMvc.perform(get("/api/orders/me").session(customer)).andExpect(status().isOk()).andReturn();
        JsonNode snapshot = null;
        for (JsonNode candidate : objectMapper.readTree(saved.getResponse().getContentAsString()).get("items")) {
            if (candidate.get("orderId").asText().equals(orderId)) snapshot = candidate;
        }
        assertEquals("旅行杯", snapshot.get("items").get(0).get("productNameZh").asText());
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

    @Test
    @Order(31)
    void categoryAndImageUploadFlowPreservesSnapshotsAndRejectsInvalidMedia() throws Exception {
        byte[] png=java.util.Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xr9sAAAAASUVORK5CYII=");
        MockHttpSession admin=login("admin","admin123");
        SessionCsrf adminCsrf=csrf(admin);
        mockMvc.perform(post("/api/product-images").session(admin).contentType("image/png").content(png))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("CSRF_INVALID"));
        MockHttpSession customer=login("customer","user123");
        SessionCsrf customerCsrf=csrf(customer);
        mockMvc.perform(post("/api/product-images").session(customer).header(customerCsrf.header(),customerCsrf.token()).contentType("image/png").content(png))
                .andExpect(status().isForbidden());
        for (var invalid: List.of(new Object[]{"image/svg+xml","<svg/>".getBytes(),415,"IMAGE_TYPE"},
                new Object[]{"image/jpeg",png,400,"IMAGE_TYPE"},new Object[]{"image/png",java.util.Arrays.copyOf(png,8),400,"IMAGE_TYPE"},
                new Object[]{"image/png",new byte[0],400,"IMAGE_EMPTY"},new Object[]{"image/png",new byte[2097153],413,"IMAGE_SIZE"})) {
            mockMvc.perform(post("/api/product-images").session(admin).header(adminCsrf.header(),adminCsrf.token())
                            .contentType((String)invalid[0]).content((byte[])invalid[1]))
                    .andExpect(status().is((Integer)invalid[2])).andExpect(jsonPath("$.code").value(invalid[3]));
        }
        assertFalse(Files.exists(dataDirectory.resolve("uploads")));
        MvcResult upload=mockMvc.perform(post("/api/product-images").session(admin).header(adminCsrf.header(),adminCsrf.token()).contentType("image/png").content(png))
                .andExpect(status().isCreated()).andReturn();
        String url=objectMapper.readTree(upload.getResponse().getContentAsString()).get("imageUrl").asText();
        mockMvc.perform(get(url)).andExpect(status().isOk()).andExpect(content().bytes(png))
                .andExpect(content().contentType("image/png")).andExpect(header().string("Cache-Control","public, max-age=31536000, immutable"))
                .andExpect(header().string("X-Content-Type-Options","nosniff")).andExpect(header().string("Content-Security-Policy","default-src 'none'; sandbox"));
        mockMvc.perform(post("/api/products").session(admin).header(adminCsrf.header(),adminCsrf.token()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"P901\",\"name\":\"Cup\",\"priceYen\":\"1234\",\"stock\":4,\"weightKg\":0.3,\"category\":\"kitchen\",\"imageUrl\":\""+url+"\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.category").value("kitchen"));
        String path="/api/products/P901/details";
        mockMvc.perform(patch(path).session(admin).header(adminCsrf.header(),adminCsrf.token()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Travel Cup\",\"category\":\"travel\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.imageUrl").value(url)).andExpect(jsonPath("$.stock").value(4)).andExpect(jsonPath("$.priceYen").value("1234"));
        mockMvc.perform(patch("/api/products/P901/names").session(admin).header(adminCsrf.header(),adminCsrf.token()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Travel Cup\",\"nameZh\":\"旅行杯\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.imageUrl").value(url)).andExpect(jsonPath("$.category").value("travel"));
        MvcResult placed=mockMvc.perform(post("/api/orders").session(customer).header(customerCsrf.header(),customerCsrf.token()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"items\":[{\"productId\":\"P901\",\"quantity\":1}]}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.items[0].productImageUrl").value(url)).andReturn();
        String orderId=objectMapper.readTree(placed.getResponse().getContentAsString()).get("orderId").asText();
        for (String invalid: List.of("{\"name\":\"Bad\",\"category\":\"invalid\"}","{\"name\":\"Bad\",\"category\":17}",
                "{\"name\":\"Bad\",\"category\":\"home\",\"imageUrl\":17}","{\"name\":\"Bad\",\"category\":\"home\",\"imageUrl\":\"https://example.com/image.png\"}","{\"name\":\"Bad\"}")) {
            mockMvc.perform(patch(path).session(admin).header(adminCsrf.header(),adminCsrf.token()).contentType(MediaType.APPLICATION_JSON).content(invalid))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        mockMvc.perform(patch(path).session(admin).header(adminCsrf.header(),adminCsrf.token()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Travel Cup\",\"category\":\"home\",\"imageUrl\":null}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.imageUrl").doesNotExist()).andExpect(jsonPath("$.stock").value(3));
        mockMvc.perform(delete("/api/products/P901").session(admin).header(adminCsrf.header(),adminCsrf.token())).andExpect(status().isNoContent());
        mockMvc.perform(get(url)).andExpect(status().isOk()).andExpect(content().bytes(png));
        MvcResult saved=mockMvc.perform(get("/api/orders/me").session(customer)).andExpect(status().isOk()).andReturn();
        for (JsonNode candidate: objectMapper.readTree(saved.getResponse().getContentAsString()).get("items")) {
            if (candidate.get("orderId").asText().equals(orderId)) assertEquals(url,candidate.get("items").get(0).get("productImageUrl").asText());
        }
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

    private int customerOrderCount(MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/orders/me").session(session))
                .andExpect(status().isOk()).andReturn();
        return objectMapper.readTree(result.getResponse().getContentAsString()).get("total").asInt();
    }

    private record SessionCsrf(MockHttpSession session, String header, String token) { }
    private record LoginBody(String username, String password) { }
}
