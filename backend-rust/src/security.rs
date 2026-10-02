//! Server-side sessions and CSRF protection, independent of Java's JSESSIONID.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, header},
    middleware::Next,
    response::Response,
};
use subtle::ConstantTimeEq;
use tokio::time::Instant;
use uuid::Uuid;

use crate::{
    api::{AppState, error_response},
    domain::{Role, User},
    error::{Code, DomainError},
};

pub const SESSION_COOKIE: &str = "RUSTSESSIONID";
pub const CSRF_HEADER: &str = "X-CSRF-TOKEN";

#[derive(Clone, Default)]
pub(crate) struct SessionContext {
    pub id: Option<String>,
    pub user: Option<User>,
    pub csrf: Option<String>,
}

impl SessionContext {
    pub fn user(&self) -> Result<User, DomainError> {
        self.user
            .clone()
            .ok_or_else(|| DomainError::new(Code::Unauthenticated))
    }

    pub fn require_role(&self, role: Role) -> Result<User, DomainError> {
        let user = self.user()?;
        if user.role != role {
            return Err(DomainError::new(Code::Forbidden));
        }
        Ok(user)
    }
}

struct Session {
    user: Option<User>,
    csrf: String,
    last_seen: Instant,
}

pub(crate) struct Sessions {
    entries: Mutex<HashMap<String, Session>>,
    timeout: Duration,
}

impl Sessions {
    pub fn new(timeout: Duration) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            timeout,
        }
    }

    pub fn lookup(&self, id: Option<&str>) -> Result<SessionContext, DomainError> {
        let Some(id) = id else {
            return Ok(SessionContext::default());
        };
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| DomainError::new(Code::InternalError))?;
        let now = Instant::now();
        if entries
            .get(id)
            .is_some_and(|session| now.duration_since(session.last_seen) >= self.timeout)
        {
            entries.remove(id);
        }
        if let Some(session) = entries.get_mut(id) {
            session.last_seen = now;
            return Ok(SessionContext {
                id: Some(id.to_owned()),
                user: session.user.clone(),
                csrf: Some(session.csrf.clone()),
            });
        }
        Ok(SessionContext::default())
    }

    pub fn create(
        &self,
        user: Option<User>,
        old_id: Option<&str>,
    ) -> Result<SessionContext, DomainError> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| DomainError::new(Code::InternalError))?;
        let now = Instant::now();
        entries.retain(|_, session| now.duration_since(session.last_seen) < self.timeout);
        if let Some(old_id) = old_id {
            entries.remove(old_id);
        }
        // Two independent UUIDs provide 244 random bits and cookie-safe hex characters.
        let id = random_token();
        let csrf = random_token();
        entries.insert(
            id.clone(),
            Session {
                user: user.clone(),
                csrf: csrf.clone(),
                last_seen: now,
            },
        );
        Ok(SessionContext {
            id: Some(id),
            user,
            csrf: Some(csrf),
        })
    }

    pub fn remove(&self, id: Option<&str>) -> Result<(), DomainError> {
        if let Some(id) = id {
            self.entries
                .lock()
                .map_err(|_| DomainError::new(Code::InternalError))?
                .remove(id);
        }
        Ok(())
    }
}

fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn cookie_session_id(headers: &HeaderMap) -> Option<String> {
    let mut result = None;
    for header in headers.get_all(header::COOKIE) {
        for part in header.to_str().ok()?.split(';') {
            let Some((key, value)) = part.trim().split_once('=') else {
                continue;
            };
            if key == SESSION_COOKIE {
                // Reject duplicate cookies rather than making an ambiguous authentication choice.
                if result.is_some()
                    || value.len() != 64
                    || !value.bytes().all(|c| c.is_ascii_hexdigit())
                {
                    return None;
                }
                result = Some(value.to_owned());
            }
        }
    }
    result
}

pub(crate) fn set_session_cookie(response: &mut Response, id: Option<&str>, secure: bool) {
    let mut cookie = format!(
        "{SESSION_COOKIE}={}; Path=/; HttpOnly; SameSite=Lax",
        id.unwrap_or("")
    );
    if id.is_none() {
        cookie.push_str("; Max-Age=0");
    }
    if secure {
        cookie.push_str("; Secure");
    }
    // Generated IDs and literal attributes cannot contain invalid header characters.
    response.headers_mut().append(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie).expect("valid session cookie"),
    );
}

pub(crate) async fn session_middleware(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_owned();
    let id = cookie_session_id(request.headers());
    let context = match state.sessions.lookup(id.as_deref()) {
        Ok(context) => context,
        Err(error) => return error_response(error, &path),
    };
    let is_safe = matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
    );
    if !is_safe {
        let supplied = request
            .headers()
            .get(CSRF_HEADER)
            .and_then(|value| value.to_str().ok());
        let valid = context
            .csrf
            .as_deref()
            .zip(supplied)
            .is_some_and(|(expected, supplied)| {
                bool::from(expected.as_bytes().ct_eq(supplied.as_bytes()))
            });
        if !valid {
            return error_response(DomainError::new(Code::CsrfInvalid), &path);
        }
    }
    // Spring Security protects the entire admin namespace, including unmapped paths.
    if (path == "/api/admin" || path.starts_with("/api/admin/"))
        && let Err(error) = context.require_role(Role::Admin)
    {
        return error_response(error, &path);
    }
    request.extensions_mut().insert(context);
    let mut response = next.run(request).await;
    if path == "/api" || path.starts_with("/api/") {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
        .headers_mut()
        .insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    response
}
