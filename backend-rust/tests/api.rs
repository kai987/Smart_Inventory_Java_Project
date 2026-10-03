use std::{
    net::{IpAddr, Ipv4Addr},
    time::Duration,
};

use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Method, Request, StatusCode, header},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use smart_inventory_rust::{api::router, config::Config, store::Store};
use tempfile::TempDir;
use tower::ServiceExt;

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Value,
    text: String,
}

async fn call(app: &Router, request: Request<Body>) -> Reply {
    let response = app.clone().oneshot(request).await.unwrap();
    let (parts, body) = response.into_parts();
    let bytes = body.collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Reply {
        status: parts.status,
        headers: parts.headers,
        body,
        text,
    }
}

struct Client {
    app: Router,
    cookie: Option<String>,
    csrf: Option<String>,
}

impl Client {
    fn new(app: &Router) -> Self {
        Self {
            app: app.clone(),
            cookie: None,
            csrf: None,
        }
    }

    fn request(&self, method: Method, path: &str, body: Option<String>) -> Request<Body> {
        let mut request = Request::builder().method(method).uri(path);
        if let Some(cookie) = &self.cookie {
            request = request.header(header::COOKIE, cookie);
        }
        if let Some(csrf) = &self.csrf {
            request = request.header("X-CSRF-TOKEN", csrf);
        }
        if body.is_some() {
            request = request.header(header::CONTENT_TYPE, "application/json");
        }
        request
            .body(body.map(Body::from).unwrap_or_else(Body::empty))
            .unwrap()
    }

    fn keyed_order(&self, key: &str, items: Value) -> Request<Body> {
        let mut request = self.request(
            Method::POST,
            "/api/orders",
            Some(json!({"items": items}).to_string()),
        );
        request
            .headers_mut()
            .insert("idempotency-key", key.parse().unwrap());
        request
    }

    async fn send_raw(&mut self, method: Method, path: &str, body: Option<String>) -> Reply {
        let response = call(&self.app, self.request(method, path, body)).await;
        if let Some(cookie) = response.headers.get(header::SET_COOKIE) {
            let cookie = cookie.to_str().unwrap().split(';').next().unwrap();
            self.cookie = (!cookie.ends_with('=')).then(|| cookie.to_owned());
        }
        response
    }

    async fn send(&mut self, method: Method, path: &str, body: Option<Value>) -> Reply {
        self.send_raw(method, path, body.map(|body| body.to_string()))
            .await
    }

    async fn fetch_csrf(&mut self) -> Reply {
        let response = self.send(Method::GET, "/api/auth/csrf", None).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        self.csrf = Some(response.body["token"].as_str().unwrap().to_owned());
        assert_eq!(response.body["headerName"], "X-CSRF-TOKEN");
        assert_eq!(response.body["parameterName"], "_csrf");
        response
    }

    async fn login(&mut self, username: &str, password: &str) {
        self.fetch_csrf().await;
        let response = self
            .send(
                Method::POST,
                "/api/auth/login",
                Some(json!({"username": username, "password": password})),
            )
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text);
        assert!(response.body.get("passwordHash").is_none());
        self.fetch_csrf().await;
    }
}

fn fixture(timeout: Duration, secure_cookie: bool) -> (TempDir, Router) {
    let directory = tempfile::tempdir().unwrap();
    let static_dir = directory.path().join("public");
    std::fs::create_dir(&static_dir).unwrap();
    std::fs::write(
        static_dir.join("index.html"),
        "<!doctype html><main>rust-test-spa</main>",
    )
    .unwrap();
    std::fs::write(static_dir.join("test.js"), "console.log('test');").unwrap();
    let data_dir = directory.path().join("data");
    let store = Store::open(&data_dir).unwrap();
    let config = Config {
        data_dir,
        static_dir,
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 0,
        allowed_origins: vec!["http://localhost:5173".to_owned()],
        secure_cookie,
        session_timeout: timeout,
        low_stock_threshold: 5,
        password_work_limit: 4,
    };
    (directory, router(store, config))
}

fn app() -> (TempDir, Router) {
    fixture(Duration::from_secs(1800), false)
}

fn assert_error(reply: &Reply, status: StatusCode, code: &str, path: &str) {
    assert_eq!(reply.status, status, "{}", reply.text);
    assert_eq!(reply.body["status"], status.as_u16());
    assert_eq!(reply.body["code"], code);
    assert_eq!(reply.body["path"], path);
    assert!(reply.body["timestamp"].as_str().unwrap().ends_with('Z'));
    assert!(reply.body["fieldErrors"].is_array());
    assert!(
        reply.headers[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("application/json")
    );
}

#[tokio::test]
async fn public_search_money_and_spa_contract() {
    let (_directory, app) = app();
    let mut client = Client::new(&app);
    let reply = client.send(Method::GET, "/api/products?q=lAp", None).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["total"], 1);
    assert_eq!(reply.body["items"][0]["id"], "P001");
    assert_eq!(reply.body["items"][0]["priceYen"], "120000");
    assert!(reply.headers.get(header::SET_COOKIE).is_none());
    let id_search = client
        .send(Method::GET, "/api/products?q=p001&inStockOnly=true", None)
        .await;
    assert_eq!(id_search.body["total"], 1);
    let invalid_query = client
        .send(Method::GET, "/api/products?inStockOnly=invalid", None)
        .await;
    assert_error(
        &invalid_query,
        StatusCode::BAD_REQUEST,
        "VALIDATION_ERROR",
        "/api/products",
    );
    for path in ["/", "/products", "/admin/products", "/orders/me"] {
        let reply = client.send(Method::GET, path, None).await;
        assert_eq!(reply.status, StatusCode::OK, "{path}");
        assert!(reply.text.contains("rust-test-spa"));
    }
    for path in [
        "/api",
        "/api/does-not-exist",
        "/assets/missing",
        "/assets/missing.js",
        "/missing.css",
    ] {
        let reply = client.send(Method::GET, path, None).await;
        assert_error(&reply, StatusCode::NOT_FOUND, "NOT_FOUND", path);
        assert!(!reply.text.contains("rust-test-spa"));
    }
    let script = client.send(Method::GET, "/test.js", None).await;
    assert_eq!(script.status, StatusCode::OK);
    assert!(script.text.contains("console.log"));
    let method = client.send(Method::GET, "/api/auth/login", None).await;
    assert_error(
        &method,
        StatusCode::METHOD_NOT_ALLOWED,
        "NOT_FOUND",
        "/api/auth/login",
    );
}

#[tokio::test]
async fn session_fixation_csrf_rotation_logout_and_cookie_flags() {
    let (_directory, app) = fixture(Duration::from_secs(1800), true);
    let mut client = Client::new(&app);
    let reply = client
        .send(
            Method::POST,
            "/api/auth/login",
            Some(json!({"username":"customer","password":"user123"})),
        )
        .await;
    assert_error(
        &reply,
        StatusCode::FORBIDDEN,
        "CSRF_INVALID",
        "/api/auth/login",
    );
    let register_without_csrf = client
        .send(
            Method::POST,
            "/api/auth/register",
            Some(json!({"username":"no_token","password":"pass1234"})),
        )
        .await;
    assert_error(
        &register_without_csrf,
        StatusCode::FORBIDDEN,
        "CSRF_INVALID",
        "/api/auth/register",
    );
    let csrf_reply = client.fetch_csrf().await;
    let cookie_attributes = csrf_reply.headers[header::SET_COOKIE].to_str().unwrap();
    for attribute in [
        "RUSTSESSIONID=",
        "HttpOnly",
        "SameSite=Lax",
        "Path=/",
        "Secure",
    ] {
        assert!(cookie_attributes.contains(attribute));
    }
    let anonymous_cookie = client.cookie.clone();
    let anonymous_csrf = client.csrf.clone();
    let login = client
        .send(
            Method::POST,
            "/api/auth/login",
            Some(json!({"username":"CUSTOMER","password":"user123"})),
        )
        .await;
    assert_eq!(login.status, StatusCode::OK, "{}", login.text);
    assert_eq!(login.body["username"], "customer");
    assert_eq!(login.body["role"], "CUSTOMER");
    assert!(login.body.get("passwordHash").is_none());
    assert_ne!(client.cookie, anonymous_cookie);
    let mut old_client = Client {
        app: app.clone(),
        cookie: anonymous_cookie,
        csrf: anonymous_csrf.clone(),
    };
    assert_error(
        &old_client.send(Method::GET, "/api/auth/me", None).await,
        StatusCode::UNAUTHORIZED,
        "UNAUTHENTICATED",
        "/api/auth/me",
    );
    let stale_csrf = client
        .send(
            Method::POST,
            "/api/orders",
            Some(json!({"items":[{"productId":"P002","quantity":1}]})),
        )
        .await;
    assert_error(
        &stale_csrf,
        StatusCode::FORBIDDEN,
        "CSRF_INVALID",
        "/api/orders",
    );
    client.fetch_csrf().await;
    assert_ne!(client.csrf, anonymous_csrf);
    let authenticated_cookie = client.cookie.clone();
    let logout = client.send(Method::POST, "/api/auth/logout", None).await;
    assert_eq!(logout.status, StatusCode::NO_CONTENT);
    assert!(
        logout.headers[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    client.cookie = authenticated_cookie;
    assert_error(
        &client.send(Method::GET, "/api/auth/me", None).await,
        StatusCode::UNAUTHORIZED,
        "UNAUTHENTICATED",
        "/api/auth/me",
    );
}

#[tokio::test]
async fn registration_cannot_set_role_and_does_not_log_in() {
    let (directory, app) = app();
    let mut client = Client::new(&app);
    client.fetch_csrf().await;
    let response = client
        .send(
            Method::POST,
            "/api/auth/register",
            Some(
                json!({"username":"new_user","password":"pass1234","role":"ADMIN","unknown":true}),
            ),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.text);
    assert_eq!(response.body["role"], "CUSTOMER");
    assert!(response.body.get("passwordHash").is_none());
    assert_error(
        &client.send(Method::GET, "/api/auth/me", None).await,
        StatusCode::UNAUTHORIZED,
        "UNAUTHENTICATED",
        "/api/auth/me",
    );
    let duplicate = client
        .send(
            Method::POST,
            "/api/auth/register",
            Some(json!({"username":"NEW_USER","password":"pass1234"})),
        )
        .await;
    assert_error(
        &duplicate,
        StatusCode::CONFLICT,
        "USERNAME_EXISTS",
        "/api/auth/register",
    );
    let saved = std::fs::read_to_string(directory.path().join("data/users.csv")).unwrap();
    assert!(!saved.contains(",pass1234,"));
    client.login("new_user", "pass1234").await;
    assert_error(
        &client.send(Method::GET, "/api/admin/summary", None).await,
        StatusCode::FORBIDDEN,
        "FORBIDDEN",
        "/api/admin/summary",
    );
}

#[tokio::test]
async fn security_roles_and_invalid_credentials_have_generic_json_errors() {
    let (_directory, app) = app();
    let mut customer = Client::new(&app);
    for path in [
        "/api/auth/me",
        "/api/orders/me",
        "/api/orders",
        "/api/admin/summary",
    ] {
        assert_error(
            &customer.send(Method::GET, path, None).await,
            StatusCode::UNAUTHORIZED,
            "UNAUTHENTICATED",
            path,
        );
    }
    customer.fetch_csrf().await;
    let injected_login = customer
        .send(
            Method::POST,
            "/api/auth/login",
            Some(json!({"username":"customer","password":"user123","role":"ADMIN"})),
        )
        .await;
    assert_error(
        &injected_login,
        StatusCode::BAD_REQUEST,
        "VALIDATION_ERROR",
        "/api/auth/login",
    );
    for username in ["missing_user", "customer"] {
        let reply = customer
            .send(
                Method::POST,
                "/api/auth/login",
                Some(json!({"username":username,"password":"wrong"})),
            )
            .await;
        assert_error(
            &reply,
            StatusCode::UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "/api/auth/login",
        );
        assert_eq!(reply.body["message"], "Invalid username or password.");
    }
    customer.login("customer", "user123").await;
    assert_error(
        &customer.send(Method::GET, "/api/orders", None).await,
        StatusCode::FORBIDDEN,
        "FORBIDDEN",
        "/api/orders",
    );
    assert_error(
        &customer
            .send(Method::DELETE, "/api/products/P001", None)
            .await,
        StatusCode::FORBIDDEN,
        "FORBIDDEN",
        "/api/products/P001",
    );
    let mut admin = Client::new(&app);
    admin.login("admin", "admin123").await;
    assert_error(
        &admin.send(Method::GET, "/api/orders/me", None).await,
        StatusCode::FORBIDDEN,
        "FORBIDDEN",
        "/api/orders/me",
    );
    assert_error(
        &admin
            .send(
                Method::POST,
                "/api/orders",
                Some(json!({"items":[{"productId":"P002","quantity":1}]})),
            )
            .await,
        StatusCode::FORBIDDEN,
        "FORBIDDEN",
        "/api/orders",
    );
    let summary = admin.send(Method::GET, "/api/admin/summary", None).await;
    assert_eq!(summary.status, StatusCode::OK);
    assert_eq!(summary.body["lowStockThreshold"], 5);
    assert!(summary.body["inventoryValueYen"].is_string());
}

#[tokio::test]
async fn strict_mutation_payloads_preserve_data_and_product_lifecycle() {
    let (directory, app) = app();
    let mut admin = Client::new(&app);
    admin.login("admin", "admin123").await;
    let before = std::fs::read(directory.path().join("data/products.csv")).unwrap();
    for body in [
        json!({"id":"P900","name":"Webcam","priceYen":"9800","weightKg":0.35}),
        json!({"id":"P900","name":"Webcam","priceYen":"9800","stock":null,"weightKg":0.35}),
    ] {
        let reply = admin.send(Method::POST, "/api/products", Some(body)).await;
        assert_error(
            &reply,
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "/api/products",
        );
        assert_eq!(reply.body["fieldErrors"][0]["field"], "stock");
    }
    for body in [
        json!({"id":"P900","name":"Webcam","priceYen":"9223372036854775808","stock":1,"weightKg":0.35}),
        json!({"id":"P900","name":"Webcam","priceYen":9800,"stock":1,"weightKg":0.35}),
        json!({"id":"P900","name":"Webcam","priceYen":"9800","stock":1.5,"weightKg":0.35}),
        json!({"id":"P900","name":"Webcam","priceYen":"9800","stock":1,"weightKg":0.35,"isAdmin":true}),
    ] {
        assert_error(
            &admin.send(Method::POST, "/api/products", Some(body)).await,
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "/api/products",
        );
    }
    assert_error(
        &admin
            .send_raw(Method::POST, "/api/products", Some("{broken".to_owned()))
            .await,
        StatusCode::BAD_REQUEST,
        "VALIDATION_ERROR",
        "/api/products",
    );
    assert_eq!(
        std::fs::read(directory.path().join("data/products.csv")).unwrap(),
        before
    );
    let reply = admin
        .send(
            Method::POST,
            "/api/products",
            Some(json!({"id":"P900","name":"Webcam","priceYen":"9800","stock":12,"weightKg":0.35})),
        )
        .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{}", reply.text);
    assert_eq!(reply.body["priceYen"], "9800");
    assert_eq!(
        admin
            .send(
                Method::PATCH,
                "/api/products/P900/stock",
                Some(json!({"stock":20}))
            )
            .await
            .body["stock"],
        20
    );
    assert_eq!(
        admin
            .send(Method::DELETE, "/api/products/P900", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_error(
        &admin.send(Method::GET, "/api/products/P900", None).await,
        StatusCode::NOT_FOUND,
        "PRODUCT_NOT_FOUND",
        "/api/products/P900",
    );
}

#[tokio::test]
async fn concurrent_orders_cannot_oversell_and_customer_scope_is_enforced() {
    let (directory, app) = app();
    let mut admin = Client::new(&app);
    admin.login("admin", "admin123").await;
    assert_eq!(
        admin
            .send(
                Method::PATCH,
                "/api/products/P002/stock",
                Some(json!({"stock":1}))
            )
            .await
            .status,
        StatusCode::OK
    );
    let mut customer = Client::new(&app);
    customer.login("customer", "user123").await;
    let before_orders = customer
        .send(Method::GET, "/api/orders/me", None)
        .await
        .body["total"]
        .as_u64()
        .unwrap();
    let original_files = ["products.csv", "orders.csv"]
        .map(|name| std::fs::read(directory.path().join("data").join(name)).unwrap());
    for body in [
        json!({"customerName":"admin","items":[{"productId":"P002","quantity":1}]}),
        json!({"items":[{"productId":"P002","quantity":1,"priceYen":"1"}]}),
        json!({"items":[{"productId":"P002","quantity":0}]}),
        json!({"items":[null]}),
    ] {
        assert_error(
            &customer.send(Method::POST, "/api/orders", Some(body)).await,
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "/api/orders",
        );
    }
    assert_eq!(
        std::fs::read(directory.path().join("data/products.csv")).unwrap(),
        original_files[0]
    );
    assert_eq!(
        std::fs::read(directory.path().join("data/orders.csv")).unwrap(),
        original_files[1]
    );
    let payload = json!({"items":[{"productId":"P002","quantity":1}]}).to_string();
    let first = customer.request(Method::POST, "/api/orders", Some(payload.clone()));
    let second = customer.request(Method::POST, "/api/orders", Some(payload));
    let (first, second) = tokio::join!(call(&app, first), call(&app, second));
    let (success, failure) = if first.status == StatusCode::CREATED {
        (first, second)
    } else {
        (second, first)
    };
    assert_eq!(success.status, StatusCode::CREATED, "{}", success.text);
    assert_eq!(success.body["customerName"], "customer");
    assert_eq!(success.body["totalPriceYen"], "2500");
    assert_error(
        &failure,
        StatusCode::CONFLICT,
        "INSUFFICIENT_STOCK",
        "/api/orders",
    );
    assert_eq!(failure.body["fieldErrors"][0]["field"], "items[0].quantity");
    assert_eq!(
        customer
            .send(Method::GET, "/api/products/P002", None)
            .await
            .body["stock"],
        0
    );
    let mine = customer.send(Method::GET, "/api/orders/me", None).await;
    assert_eq!(mine.body["total"].as_u64().unwrap(), before_orders + 1);
    assert!(
        mine.body["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["customerName"] == "customer")
    );
    let filtered = admin
        .send(Method::GET, "/api/orders?customer=CUSTOMER", None)
        .await;
    assert_eq!(filtered.body["total"], mine.body["total"]);
    assert!(
        filtered.body["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["customerName"] == "customer")
    );
}

#[tokio::test]
async fn concurrent_keyed_orders_commit_once_and_replay_matches_normalized_intent() {
    let (directory, app) = app();
    let mut customer = Client::new(&app);
    customer.login("customer", "user123").await;
    let key = "browser-retry-12345";
    let items = json!([{"productId":"P002","quantity":2},{"productId":"P002","quantity":1}]);
    let before = customer
        .send(Method::GET, "/api/orders/me", None)
        .await
        .body["total"]
        .as_u64()
        .unwrap();
    let (first, second) = tokio::join!(
        call(&app, customer.keyed_order(key, items.clone())),
        call(&app, customer.keyed_order(key, items)),
    );
    assert_eq!(first.status, StatusCode::CREATED, "{}", first.text);
    assert_eq!(second.status, StatusCode::CREATED, "{}", second.text);
    assert_eq!(first.body, second.body);
    assert_eq!(first.body["items"][0]["quantity"], 3);
    assert_eq!(
        customer
            .send(Method::GET, "/api/products/P002", None)
            .await
            .body["stock"],
        27
    );
    assert_eq!(
        customer
            .send(Method::GET, "/api/orders/me", None)
            .await
            .body["total"],
        before + 1
    );
    let saved = std::fs::read(directory.path().join("data/orders.csv")).unwrap();
    let replay = call(
        &app,
        customer.keyed_order(key, json!([{"productId":"P002","quantity":3}])),
    )
    .await;
    assert_eq!(replay.body, first.body);
    assert_eq!(
        std::fs::read(directory.path().join("data/orders.csv")).unwrap(),
        saved
    );
    assert_error(
        &call(
            &app,
            customer.keyed_order(key, json!([{"productId":"P002","quantity":4}])),
        )
        .await,
        StatusCode::CONFLICT,
        "IDEMPOTENCY_CONFLICT",
        "/api/orders",
    );
    assert_error(
        &call(
            &app,
            customer.keyed_order(key, json!([{"productId":"P002","quantity":0}])),
        )
        .await,
        StatusCode::BAD_REQUEST,
        "VALIDATION_ERROR",
        "/api/orders",
    );
}

#[tokio::test]
async fn keyed_order_header_validation_and_customer_scope_preserve_stock() {
    let (_directory, app) = app();
    let mut customer = Client::new(&app);
    customer.login("customer", "user123").await;
    let items = json!([{"productId":"P002","quantity":1}]);
    for key in [
        "",
        "too-short",
        "0123456789abcdef:bad",
        "contains a space here",
    ] {
        assert_error(
            &call(&app, customer.keyed_order(key, items.clone())).await,
            StatusCode::BAD_REQUEST,
            "VALIDATION_ERROR",
            "/api/orders",
        );
    }
    let mut duplicated = customer.keyed_order("duplicate-key-1234", items.clone());
    duplicated
        .headers_mut()
        .append("idempotency-key", "duplicate-key-1234".parse().unwrap());
    assert_error(
        &call(&app, duplicated).await,
        StatusCode::BAD_REQUEST,
        "VALIDATION_ERROR",
        "/api/orders",
    );
    assert_eq!(
        customer
            .send(Method::GET, "/api/products/P002", None)
            .await
            .body["stock"],
        30
    );
    let key = "same-key-two-users";
    let first = call(&app, customer.keyed_order(key, items.clone())).await;
    let mut second_customer = Client::new(&app);
    second_customer.fetch_csrf().await;
    assert_eq!(
        second_customer
            .send(
                Method::POST,
                "/api/auth/register",
                Some(json!({"username":"bobby","password":"password"}))
            )
            .await
            .status,
        StatusCode::CREATED
    );
    second_customer.login("bobby", "password").await;
    let second = call(&app, second_customer.keyed_order(key, items.clone())).await;
    assert_eq!(second.status, StatusCode::CREATED);
    assert_eq!(second.body["customerName"], "bobby");
    assert_ne!(first.body["orderId"], second.body["orderId"]);
    let mut admin = Client::new(&app);
    admin.login("admin", "admin123").await;
    assert_error(
        &call(&app, admin.keyed_order(key, items)).await,
        StatusCode::FORBIDDEN,
        "FORBIDDEN",
        "/api/orders",
    );
    assert_eq!(
        customer
            .send(Method::GET, "/api/products/P002", None)
            .await
            .body["stock"],
        28
    );
}

#[tokio::test]
async fn concurrent_registration_cannot_persist_duplicate_names() {
    let (directory, app) = app();
    let mut first = Client::new(&app);
    let mut second = Client::new(&app);
    first.fetch_csrf().await;
    second.fetch_csrf().await;
    let body = json!({"username":"race_user","password":"password"}).to_string();
    let (first, second) = tokio::join!(
        call(
            &app,
            first.request(Method::POST, "/api/auth/register", Some(body.clone()))
        ),
        call(
            &app,
            second.request(Method::POST, "/api/auth/register", Some(body))
        ),
    );
    let (success, failure) = if first.status == StatusCode::CREATED {
        (first, second)
    } else {
        (second, first)
    };
    assert_eq!(success.status, StatusCode::CREATED, "{}", success.text);
    assert_error(
        &failure,
        StatusCode::CONFLICT,
        "USERNAME_EXISTS",
        "/api/auth/register",
    );
    let users = std::fs::read_to_string(directory.path().join("data/users.csv")).unwrap();
    assert_eq!(
        users
            .lines()
            .filter(|line| line.starts_with("race_user,"))
            .count(),
        1
    );
}

#[tokio::test]
async fn bounded_json_and_cors_allow_only_configured_origin() {
    let (_directory, app) = app();
    let mut client = Client::new(&app);
    client.fetch_csrf().await;
    let oversized = client
        .send_raw(
            Method::POST,
            "/api/auth/register",
            Some(" ".repeat(1024 * 1024 + 1)),
        )
        .await;
    assert_error(
        &oversized,
        StatusCode::PAYLOAD_TOO_LARGE,
        "VALIDATION_ERROR",
        "/api/auth/register",
    );
    let mut wrong_type = client.request(Method::POST, "/api/auth/register", Some("{}".to_owned()));
    wrong_type
        .headers_mut()
        .insert(header::CONTENT_TYPE, "text/plain".parse().unwrap());
    assert_error(
        &call(&app, wrong_type).await,
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "VALIDATION_ERROR",
        "/api/auth/register",
    );
    for (origin, allowed) in [
        ("http://localhost:5173", true),
        ("https://attacker.invalid", false),
    ] {
        let preflight = Request::builder()
            .method(Method::OPTIONS)
            .uri("/api/auth/login")
            .header(header::ORIGIN, origin)
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(
                header::ACCESS_CONTROL_REQUEST_HEADERS,
                "content-type,x-csrf-token,idempotency-key",
            )
            .body(Body::empty())
            .unwrap();
        let reply = call(&app, preflight).await;
        assert_eq!(
            reply
                .headers
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_some(),
            allowed
        );
        if allowed {
            assert_eq!(reply.headers[header::ACCESS_CONTROL_ALLOW_ORIGIN], origin);
            assert_eq!(
                reply.headers[header::ACCESS_CONTROL_ALLOW_CREDENTIALS],
                "true"
            );
            assert!(
                reply.headers[header::ACCESS_CONTROL_ALLOW_HEADERS]
                    .to_str()
                    .unwrap()
                    .contains("idempotency-key")
            );
        }
    }
}

#[tokio::test(start_paused = true)]
async fn sessions_expire_after_inactivity_and_unknown_cookies_are_not_adopted() {
    let (_directory, app) = fixture(Duration::from_millis(250), false);
    let mut client = Client::new(&app);
    client.cookie = Some(format!("RUSTSESSIONID={}", "a".repeat(64)));
    let attacker_cookie = client.cookie.clone();
    client.fetch_csrf().await;
    assert_ne!(client.cookie, attacker_cookie);
    client.login("customer", "user123").await;
    tokio::time::advance(Duration::from_millis(150)).await;
    assert_eq!(
        client.send(Method::GET, "/api/auth/me", None).await.status,
        StatusCode::OK
    );
    tokio::time::advance(Duration::from_millis(150)).await;
    assert_eq!(
        client.send(Method::GET, "/api/auth/me", None).await.status,
        StatusCode::OK
    );
    tokio::time::advance(Duration::from_millis(300)).await;
    assert_error(
        &client.send(Method::GET, "/api/auth/me", None).await,
        StatusCode::UNAUTHORIZED,
        "UNAUTHENTICATED",
        "/api/auth/me",
    );
    assert_error(
        &client.send(Method::POST, "/api/auth/logout", None).await,
        StatusCode::FORBIDDEN,
        "CSRF_INVALID",
        "/api/auth/logout",
    );
}
