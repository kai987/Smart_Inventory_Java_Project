//! HTTP compatibility layer for the existing Spring Boot / React API contract.

use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Extension, OriginalUri, Path, RawQuery, Request, State, rejection::PathRejection},
    http::{HeaderValue, Method, StatusCode, Uri, header},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::sync::Semaphore;
use tower::ServiceExt;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
};

use crate::{
    config::Config,
    domain::{RequestedItem, Role, User, encode_password, verify_password},
    error::{Code, DomainError, FieldError},
    security::{CSRF_HEADER, SessionContext, Sessions, session_middleware, set_session_cookie},
    store::Store,
};

const MAX_BODY_BYTES: usize = 1024 * 1024;

pub(crate) struct AppState {
    store: Arc<Mutex<Store>>,
    pub sessions: Sessions,
    config: Config,
    password_work: Arc<Semaphore>,
}

/// Build the API and optional prebuilt React SPA with one shared transaction lock.
pub fn router(store: Store, config: Config) -> Router {
    let origins: Vec<HeaderValue> = config
        .allowed_origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::HeaderName::from_static("x-csrf-token"),
            header::HeaderName::from_static("idempotency-key"),
        ])
        .max_age(Duration::from_secs(3600));
    let state = Arc::new(AppState {
        store: Arc::new(Mutex::new(store)),
        sessions: Sessions::new(config.session_timeout),
        password_work: Arc::new(Semaphore::new(config.password_work_limit.max(1))),
        config,
    });
    Router::new()
        .route("/api/auth/csrf", get(csrf))
        .route("/api/auth/login", post(login))
        .route("/api/auth/register", post(register))
        .route("/api/auth/me", get(me))
        .route("/api/auth/logout", post(logout))
        .route("/api/products", get(products).post(create_product))
        .route("/api/products/{id}", get(product).delete(delete_product))
        .route("/api/products/{id}/stock", patch(update_stock))
        .route("/api/orders", get(all_orders).post(create_order))
        .route("/api/orders/me", get(my_orders))
        .route("/api/admin/summary", get(summary))
        .fallback(static_or_not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            session_middleware,
        ))
        .layer(cors)
        .with_state(state)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody<'a> {
    timestamp: String,
    status: u16,
    code: &'static str,
    message: String,
    path: &'a str,
    field_errors: Vec<FieldError>,
}

pub(crate) fn error_response(error: DomainError, path: &str) -> Response {
    error_response_with_status(error, path, None)
}

fn error_response_with_status(
    error: DomainError,
    path: &str,
    override_status: Option<StatusCode>,
) -> Response {
    let status = override_status.unwrap_or_else(|| {
        StatusCode::from_u16(error.code.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
    });
    let body = ErrorBody {
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        status: status.as_u16(),
        code: error.code.as_str(),
        message: error.message,
        path,
        field_errors: error.field_errors,
    };
    let mut response = (status, Json(body)).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if error.code == Code::RateLimited {
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("1"));
    }
    response
}

fn result_response<T: Serialize>(
    result: Result<T, DomainError>,
    path: &str,
    status: StatusCode,
) -> Response {
    match result {
        Ok(value) => (status, Json(value)).into_response(),
        Err(error) => error_response(error, path),
    }
}

async fn with_store<T, F>(state: &Arc<AppState>, operation: F) -> Result<T, DomainError>
where
    T: Send + 'static,
    F: FnOnce(&mut Store) -> Result<T, DomainError> + Send + 'static,
{
    let store = state.store.clone();
    tokio::task::spawn_blocking(move || {
        let mut store = store
            .lock()
            .map_err(|_| DomainError::new(Code::InternalError))?;
        operation(&mut store)
    })
    .await
    .map_err(|_| DomainError::new(Code::InternalError))?
}

// Fail fast instead of accumulating an unbounded BCrypt queue. The blocking
// task owns the permit, so cancelling an HTTP request cannot free it early.
async fn password_work<T, F>(state: &Arc<AppState>, operation: F) -> Result<T, DomainError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, DomainError> + Send + 'static,
{
    let permit = state
        .password_work
        .clone()
        .try_acquire_owned()
        .map_err(|_| DomainError::new(Code::RateLimited))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        operation()
    })
    .await
    .map_err(|_| DomainError::new(Code::InternalError))?
}

async fn read_json<T: DeserializeOwned>(request: Request) -> Result<T, Response> {
    let path = request.uri().path().to_owned();
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if content_type != "application/json"
        && !(content_type.starts_with("application/") && content_type.ends_with("+json"))
    {
        return Err(error_response_with_status(
            DomainError::with_message(
                Code::ValidationError,
                "Content-Type must be application/json.",
            ),
            &path,
            Some(StatusCode::UNSUPPORTED_MEDIA_TYPE),
        ));
    }
    let bytes = to_bytes(request.into_body(), MAX_BODY_BYTES)
        .await
        .map_err(|_| {
            error_response_with_status(
                DomainError::with_message(
                    Code::ValidationError,
                    "The request body is too large or could not be read.",
                ),
                &path,
                Some(StatusCode::PAYLOAD_TOO_LARGE),
            )
        })?;
    serde_json::from_slice(&bytes).map_err(|_| {
        error_response(
            DomainError::with_message(Code::ValidationError, "The request body is invalid."),
            &path,
        )
    })
}

fn required<T>(value: Option<T>, field: &str) -> Result<T, DomainError> {
    value.ok_or_else(|| DomainError::field(field, "must not be null"))
}

fn required_text(value: Option<String>, field: &str) -> Result<String, DomainError> {
    let value = required(value, field)?;
    if value.trim().is_empty() {
        return Err(DomainError::field(field, "must not be blank"));
    }
    Ok(value)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CsrfResponse {
    token: String,
    header_name: &'static str,
    parameter_name: &'static str,
}

async fn csrf(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    let new_session = context.id.is_none();
    let context = if new_session {
        match state.sessions.create(None, None) {
            Ok(context) => context,
            Err(error) => return error_response(error, uri.path()),
        }
    } else {
        context
    };
    let mut response = Json(CsrfResponse {
        token: context.csrf.unwrap_or_default(),
        header_name: CSRF_HEADER,
        parameter_name: "_csrf",
    })
    .into_response();
    if new_session {
        set_session_cookie(
            &mut response,
            context.id.as_deref(),
            state.config.secure_cookie,
        );
    }
    response
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginRequest {
    username: Option<String>,
    password: Option<String>,
}

async fn login(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
    request: Request,
) -> Response {
    let body: LoginRequest = match read_json(request).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let credentials = (|| {
        Ok::<_, DomainError>((
            required_text(body.username, "username")?,
            required_text(body.password, "password")?,
        ))
    })();
    let (username, password) = match credentials {
        Ok(value) => value,
        Err(error) => return error_response(error, uri.path()),
    };
    let store = state.store.clone();
    let result = password_work(&state, move || {
        let user = store
            .lock()
            .map_err(|_| DomainError::new(Code::InternalError))?
            .find_user(&username);
        // Spend a password-verification work unit even for an unknown username.
        static DUMMY_HASH: OnceLock<String> = OnceLock::new();
        let hash = match user.as_ref() {
            Some(user) => user.password_hash.as_str(),
            None => DUMMY_HASH
                .get_or_init(|| {
                    bcrypt::hash("dummy-password-not-a-user", 10).expect("bcrypt with valid cost")
                })
                .as_str(),
        };
        if !verify_password(&password, hash) {
            return Err(DomainError::new(Code::InvalidCredentials));
        }
        user.ok_or_else(|| DomainError::new(Code::InvalidCredentials))
    })
    .await;
    let user = match result {
        Ok(user) => user,
        Err(error) => return error_response(error, uri.path()),
    };
    match state
        .sessions
        .create(Some(user.clone()), context.id.as_deref())
    {
        Ok(session) => {
            let mut response = Json(user).into_response();
            set_session_cookie(
                &mut response,
                session.id.as_deref(),
                state.config.secure_cookie,
            );
            response
        }
        Err(error) => error_response(error, uri.path()),
    }
}

// Registration intentionally ignores client-supplied authority and unknown fields,
// matching @JsonIgnoreProperties(ignoreUnknown = true) in the Java DTO.
#[derive(Deserialize)]
struct RegisterRequest {
    username: Option<String>,
    password: Option<String>,
}

async fn register(
    State(state): State<Arc<AppState>>,
    OriginalUri(uri): OriginalUri,
    request: Request,
) -> Response {
    let body: RegisterRequest = match read_json(request).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = async {
        let username = required_text(body.username, "username")?;
        let password = required_text(body.password, "password")?;
        register_user(&state, username, password, encode_password).await
    }
    .await;
    result_response(result, uri.path(), StatusCode::CREATED)
}

async fn register_user<F>(
    state: &Arc<AppState>,
    username: String,
    password: String,
    hash_password: F,
) -> Result<User, DomainError>
where
    F: FnOnce(&str) -> Result<String, DomainError> + Send + 'static,
{
    Store::validate_registration(&username, &password)?;
    let candidate = username.clone();
    with_store(state, move |store| {
        store.check_username_available(&candidate)
    })
    .await?;
    let hash = password_work(state, move || hash_password(&password)).await?;
    with_store(state, move |store| store.register_hashed(&username, hash)).await
}

async fn me(
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    result_response(context.user(), uri.path(), StatusCode::OK)
}

async fn logout(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    if let Err(error) = context
        .user()
        .and_then(|_| state.sessions.remove(context.id.as_deref()))
    {
        return error_response(error, uri.path());
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    set_session_cookie(&mut response, None, state.config.secure_cookie);
    response
}

#[derive(Serialize)]
struct ItemList<T> {
    items: Vec<T>,
    total: usize,
}
impl<T> ItemList<T> {
    fn new(items: Vec<T>) -> Self {
        Self {
            total: items.len(),
            items,
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductQuery {
    q: Option<String>,
    in_stock_only: Option<String>,
}

async fn products(
    State(state): State<Arc<AppState>>,
    OriginalUri(uri): OriginalUri,
    RawQuery(query): RawQuery,
) -> Response {
    let query: ProductQuery = match serde_urlencoded::from_str(query.as_deref().unwrap_or("")) {
        Ok(query) => query,
        Err(_) => return error_response(DomainError::new(Code::ValidationError), uri.path()),
    };
    let in_stock_only = match query
        .in_stock_only
        .as_deref()
        .unwrap_or("false")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "true" | "on" | "yes" | "1" => true,
        "false" | "off" | "no" | "0" | "" => false,
        _ => return error_response(DomainError::new(Code::ValidationError), uri.path()),
    };
    let result = with_store(&state, move |store| {
        Ok(ItemList::new(
            store.list_products(query.q.as_deref(), in_stock_only),
        ))
    })
    .await;
    result_response(result, uri.path(), StatusCode::OK)
}

fn path_id(value: Result<Path<String>, PathRejection>) -> Result<String, DomainError> {
    value
        .map(|Path(value)| value)
        .map_err(|_| DomainError::new(Code::ValidationError))
}

async fn product(
    State(state): State<Arc<AppState>>,
    OriginalUri(uri): OriginalUri,
    id: Result<Path<String>, PathRejection>,
) -> Response {
    let id = match path_id(id) {
        Ok(id) => id,
        Err(error) => return error_response(error, uri.path()),
    };
    let result = with_store(&state, move |store| store.get_product(&id)).await;
    result_response(result, uri.path(), StatusCode::OK)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProductRequest {
    id: Option<String>,
    name: Option<String>,
    price_yen: Option<String>,
    stock: Option<i32>,
    weight_kg: Option<f64>,
}

async fn create_product(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
    request: Request,
) -> Response {
    if let Err(error) = context.require_role(Role::Admin) {
        return error_response(error, uri.path());
    }
    let body: ProductRequest = match read_json(request).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = with_store(&state, move |store| {
        store.add_product(
            &required_text(body.id, "id")?,
            &required_text(body.name, "name")?,
            &required_text(body.price_yen, "priceYen")?,
            required(body.stock, "stock")?,
            required(body.weight_kg, "weightKg")?,
        )
    })
    .await;
    result_response(result, uri.path(), StatusCode::CREATED)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StockRequest {
    stock: Option<i32>,
}

async fn update_stock(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
    id: Result<Path<String>, PathRejection>,
    request: Request,
) -> Response {
    if let Err(error) = context.require_role(Role::Admin) {
        return error_response(error, uri.path());
    }
    let id = match path_id(id) {
        Ok(id) => id,
        Err(error) => return error_response(error, uri.path()),
    };
    let body: StockRequest = match read_json(request).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = with_store(&state, move |store| {
        store.update_stock(&id, required(body.stock, "stock")?)
    })
    .await;
    result_response(result, uri.path(), StatusCode::OK)
}

async fn delete_product(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
    id: Result<Path<String>, PathRejection>,
) -> Response {
    if let Err(error) = context.require_role(Role::Admin) {
        return error_response(error, uri.path());
    }
    let id = match path_id(id) {
        Ok(id) => id,
        Err(error) => return error_response(error, uri.path()),
    };
    match with_store(&state, move |store| store.delete_product(&id)).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => error_response(error, uri.path()),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OrderRequest {
    items: Option<Vec<Option<OrderItemRequest>>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OrderItemRequest {
    product_id: Option<String>,
    quantity: Option<i32>,
}

async fn create_order(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
    request: Request,
) -> Response {
    let user = match context.require_role(Role::Customer) {
        Ok(user) => user,
        Err(error) => return error_response(error, uri.path()),
    };
    let idempotency_key = match request
        .headers()
        .get_all("idempotency-key")
        .iter()
        .collect::<Vec<_>>()
        .as_slice()
    {
        [] => None,
        [value] => match value.to_str() {
            Ok(value) => Some(value.to_owned()),
            Err(_) => {
                return error_response(
                    DomainError::field("idempotencyKey", "The submission key is invalid."),
                    uri.path(),
                );
            }
        },
        _ => {
            return error_response(
                DomainError::field("idempotencyKey", "Supply only one submission key."),
                uri.path(),
            );
        }
    };
    let body: OrderRequest = match read_json(request).await {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = with_store(&state, move |store| {
        let raw_items = required(body.items, "items")?;
        if raw_items.is_empty() {
            return Err(DomainError::field("items", "must not be empty"));
        }
        let items = raw_items
            .into_iter()
            .enumerate()
            .map(|(i, item)| {
                let item = required(item, &format!("items[{i}]"))?;
                Ok(RequestedItem {
                    product_id: required_text(item.product_id, &format!("items[{i}].productId"))?,
                    quantity: required(item.quantity, &format!("items[{i}].quantity"))?,
                })
            })
            .collect::<Result<Vec<_>, DomainError>>()?;
        store.create_order_with_key(&user.username, items, idempotency_key.as_deref())
    })
    .await;
    result_response(result, uri.path(), StatusCode::CREATED)
}

async fn my_orders(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    let user = match context.require_role(Role::Customer) {
        Ok(user) => user,
        Err(error) => return error_response(error, uri.path()),
    };
    let result = with_store(&state, move |store| {
        Ok(ItemList::new(store.orders_for_customer(&user.username)))
    })
    .await;
    result_response(result, uri.path(), StatusCode::OK)
}

#[derive(Default, Deserialize)]
struct OrderQuery {
    customer: Option<String>,
}

async fn all_orders(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
    RawQuery(query): RawQuery,
) -> Response {
    if let Err(error) = context.require_role(Role::Admin) {
        return error_response(error, uri.path());
    }
    let query: OrderQuery = match serde_urlencoded::from_str(query.as_deref().unwrap_or("")) {
        Ok(query) => query,
        Err(_) => return error_response(DomainError::new(Code::ValidationError), uri.path()),
    };
    let result = with_store(&state, move |store| {
        Ok(ItemList::new(store.all_orders(query.customer.as_deref())))
    })
    .await;
    result_response(result, uri.path(), StatusCode::OK)
}

async fn summary(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<SessionContext>,
    OriginalUri(uri): OriginalUri,
) -> Response {
    if let Err(error) = context.require_role(Role::Admin) {
        return error_response(error, uri.path());
    }
    let threshold = state.config.low_stock_threshold;
    result_response(
        with_store(&state, move |store| Ok(store.summary(threshold))).await,
        uri.path(),
        StatusCode::OK,
    )
}

async fn method_not_allowed(OriginalUri(uri): OriginalUri) -> Response {
    error_response_with_status(
        DomainError::with_message(
            Code::NotFound,
            "The request method is not supported for this resource.",
        ),
        uri.path(),
        Some(StatusCode::METHOD_NOT_ALLOWED),
    )
}

async fn static_or_not_found(State(state): State<Arc<AppState>>, request: Request) -> Response {
    let path = request.uri().path().to_owned();
    if path == "/api" || path.starts_with("/api/") {
        return error_response(DomainError::new(Code::NotFound), &path);
    }
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return error_response_with_status(
            DomainError::new(Code::NotFound),
            &path,
            Some(StatusCode::METHOD_NOT_ALLOWED),
        );
    }
    let is_head = request.method() == Method::HEAD;
    let static_dir: PathBuf = state.config.static_dir.clone();
    let response = match ServeDir::new(&static_dir).oneshot(request).await {
        Ok(response) => response.map(Body::new),
        Err(_) => return error_response(DomainError::new(Code::InternalError), &path),
    };
    if response.status() != StatusCode::NOT_FOUND {
        return response;
    }
    let last_segment = path.rsplit('/').next().unwrap_or("");
    // Missing assets are genuine 404s. Only extensionless navigation may use index.html.
    if last_segment.contains('.')
        || path == "/assets"
        || path.starts_with("/assets/")
        || path.contains('%')
        || path.split('/').any(|part| part == ".." || part == ".")
    {
        return error_response(DomainError::new(Code::NotFound), &path);
    }
    let index_request = Request::builder()
        .method(if is_head { Method::HEAD } else { Method::GET })
        .uri(Uri::from_static("/index.html"))
        .body(Body::empty())
        .expect("valid static request");
    match ServeFile::new(static_dir.join("index.html"))
        .oneshot(index_request)
        .await
    {
        Ok(response) if response.status() != StatusCode::NOT_FOUND => response.map(Body::new),
        Ok(_) => error_response(DomainError::new(Code::NotFound), &path),
        Err(_) => error_response(DomainError::new(Code::InternalError), &path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use http_body_util::BodyExt;

    fn state(directory: &std::path::Path) -> Arc<AppState> {
        let config = Config {
            password_work_limit: 1,
            ..Config::default()
        };
        Arc::new(AppState {
            store: Arc::new(Mutex::new(Store::open(directory).unwrap())),
            sessions: Sessions::new(config.session_timeout),
            password_work: Arc::new(Semaphore::new(config.password_work_limit)),
            config,
        })
    }

    fn auth_request(path: &str, username: &str) -> Request {
        Request::builder()
            .method(Method::POST)
            .uri(path)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({"username": username, "password": "password"}).to_string(),
            ))
            .unwrap()
    }

    #[tokio::test]
    async fn login_and_registration_share_a_fail_fast_password_work_limit() {
        let directory = tempfile::tempdir().unwrap();
        let state = state(directory.path());
        let permit = state.password_work.clone().acquire_owned().await.unwrap();
        let uri: Uri = "/api/auth/login".parse().unwrap();
        let response = login(
            State(state.clone()),
            Extension(SessionContext::default()),
            OriginalUri(uri),
            auth_request("/api/auth/login", "customer"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[header::RETRY_AFTER], "1");
        let body: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["code"], "RATE_LIMITED");
        let uri: Uri = "/api/auth/register".parse().unwrap();
        let response = register(
            State(state.clone()),
            OriginalUri(uri.clone()),
            auth_request("/api/auth/register", "new_user"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        // Validate before acquiring scarce CPU capacity or saving an account.
        let response = register(
            State(state.clone()),
            OriginalUri(uri),
            auth_request("/api/auth/register", "!"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(
            with_store(&state, |store| Ok(store.find_user("new_user")))
                .await
                .unwrap()
                .is_none()
        );
        drop(permit);
        assert!(password_work(&state, || Ok(())).await.is_ok());
    }

    #[tokio::test]
    async fn password_work_keeps_store_available_and_keeps_permit_after_request_cancellation() {
        let directory = tempfile::tempdir().unwrap();
        let state = state(directory.path());
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker_state = state.clone();
        let work = tokio::spawn(async move {
            password_work(&worker_state, move || {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
            .await
        });
        started_rx.await.unwrap();
        let count = tokio::time::timeout(
            Duration::from_secs(2),
            with_store(&state, |store| Ok(store.list_products(None, false).len())),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(count, 4);
        work.abort();
        assert_eq!(
            password_work(&state, || Ok(())).await.unwrap_err().code,
            Code::RateLimited
        );
        release_tx.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if state.password_work.available_permits() == 1 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(password_work(&state, || Ok(())).await.is_ok());
    }

    #[tokio::test]
    async fn product_reads_proceed_while_registration_hash_is_blocked() {
        let directory = tempfile::tempdir().unwrap();
        let state = state(directory.path());
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let registration_state = state.clone();
        let registration = tokio::spawn(async move {
            register_user(
                &registration_state,
                "new_user".into(),
                "password".into(),
                move |password| {
                    started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    encode_password(password)
                },
            )
            .await
        });
        started_rx.await.unwrap();
        let response = tokio::time::timeout(
            Duration::from_secs(2),
            products(
                State(state.clone()),
                OriginalUri("/api/products".parse().unwrap()),
                RawQuery(None),
            ),
        )
        .await;
        release_tx.send(()).unwrap();
        let response = response.expect("A registration hash must not block product reads");
        assert_eq!(response.status(), StatusCode::OK);
        let body: serde_json::Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["total"], 4);
        assert_eq!(registration.await.unwrap().unwrap().username, "new_user");
    }
}
