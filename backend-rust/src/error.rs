use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Code {
    ValidationError,
    InvalidCredentials,
    Unauthenticated,
    Forbidden,
    CsrfInvalid,
    UsernameExists,
    ProductExists,
    ProductNotFound,
    EmptyOrder,
    InsufficientStock,
    IdempotencyConflict,
    RateLimited,
    PersistenceError,
    NotFound,
    InternalError,
}

impl Code {
    pub fn status(self) -> u16 {
        match self {
            Self::ValidationError | Self::EmptyOrder => 400,
            Self::InvalidCredentials | Self::Unauthenticated => 401,
            Self::Forbidden | Self::CsrfInvalid => 403,
            Self::ProductNotFound | Self::NotFound => 404,
            Self::UsernameExists
            | Self::ProductExists
            | Self::InsufficientStock
            | Self::IdempotencyConflict => 409,
            Self::RateLimited => 429,
            Self::PersistenceError | Self::InternalError => 500,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ValidationError => "VALIDATION_ERROR",
            Self::InvalidCredentials => "INVALID_CREDENTIALS",
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::Forbidden => "FORBIDDEN",
            Self::CsrfInvalid => "CSRF_INVALID",
            Self::UsernameExists => "USERNAME_EXISTS",
            Self::ProductExists => "PRODUCT_EXISTS",
            Self::ProductNotFound => "PRODUCT_NOT_FOUND",
            Self::EmptyOrder => "EMPTY_ORDER",
            Self::InsufficientStock => "INSUFFICIENT_STOCK",
            Self::IdempotencyConflict => "IDEMPOTENCY_CONFLICT",
            Self::RateLimited => "RATE_LIMITED",
            Self::PersistenceError => "PERSISTENCE_ERROR",
            Self::NotFound => "NOT_FOUND",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }

    pub fn default_message(self) -> &'static str {
        match self {
            Self::ValidationError => "One or more fields are invalid.",
            Self::InvalidCredentials => "Invalid username or password.",
            Self::Unauthenticated => "Authentication is required.",
            Self::Forbidden => "You do not have permission to perform this action.",
            Self::CsrfInvalid => "The security token is missing or invalid.",
            Self::UsernameExists => "That username is already registered.",
            Self::ProductExists => "A product with that ID already exists.",
            Self::ProductNotFound => "The requested product was not found.",
            Self::EmptyOrder => "An order must contain at least one item.",
            Self::InsufficientStock => "One or more products do not have enough stock.",
            Self::IdempotencyConflict => {
                "That submission key was already used for a different order."
            }
            Self::RateLimited => "Too many authentication requests. Please try again shortly.",
            Self::PersistenceError => "The data could not be saved safely.",
            Self::NotFound => "The requested resource was not found.",
            Self::InternalError => "An unexpected error occurred.",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

#[derive(Clone, Debug)]
pub struct DomainError {
    pub code: Code,
    pub message: String,
    pub field_errors: Vec<FieldError>,
}

impl DomainError {
    pub fn new(code: Code) -> Self {
        Self::with_message(code, code.default_message())
    }

    pub fn with_message(code: Code, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            field_errors: Vec::new(),
        }
    }

    pub fn field(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: Code::ValidationError,
            message: Code::ValidationError.default_message().into(),
            field_errors: vec![FieldError {
                field: field.into(),
                message: message.into(),
            }],
        }
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for DomainError {}
